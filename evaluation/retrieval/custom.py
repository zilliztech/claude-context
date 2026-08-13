import traceback
from typing import List, Dict, Any
import asyncio
from contextlib import asynccontextmanager
from retrieval.base import BaseRetrieval
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools
import os
import logging
import sys
import time
from client import Evaluator
from utils.llm_factory import llm_factory
from utils.constant import project_path, evaluation_path
from utils.format import extract_oracle_files_from_patch, create_unified_diff_file
import json
import traceback
from tqdm.auto import tqdm
from typing import List, Dict, Any

from utils.file_management import ContextManager, clone_repo

logger = logging.getLogger(__name__)


class CustomRetrieval(BaseRetrieval):
    def __init__(
        self,
        llm_type: str,
        llm_model: str,
        retrieval_types: List[str],
        *,
        dataset_name_or_path,
        splits,
        output_dir,
        **kwargs,
    ):
        """
        Initialize CustomRetrieval with specified retrieval types.
        
        Args:
            llm_type: Type of LLM to use
            llm_model: LLM model name
            retrieval_types: List containing "cc", "grep", or both
            dataset_name_or_path: Dataset path
            splits: Dataset splits
            output_dir: Output directory
            **kwargs: Additional arguments
        """
        super().__init__(
            dataset_name_or_path=dataset_name_or_path,
            splits=splits,
            output_dir=output_dir,
            **kwargs,
        )

        # Validate retrieval types
        valid_types = {"cc", "grep"}
        if not isinstance(retrieval_types, list):
            raise ValueError("retrieval_types must be a list")
        if not all(rt in valid_types for rt in retrieval_types):
            raise ValueError(
                f"retrieval_types must contain only 'cc' and/or 'grep', got: {retrieval_types}"
            )
        if not retrieval_types:
            raise ValueError("retrieval_types cannot be empty")

        self.retrieval_types = retrieval_types
        self.llm_model = llm_factory(llm_type, llm_model)
        self.mcp_client = self._create_mcp_client()

    def _create_mcp_client(self) -> MultiServerMCPClient:
        """Create MCP client based on retrieval types"""
        servers = {
            "filesystem": {
                "command": sys.executable,
                "args": [str(evaluation_path / "servers/read_server.py"),],
                "transport": "stdio",
            },
            "edit": {
                "command": sys.executable,
                "args": [str(evaluation_path / "servers/edit_server.py"),],
                "transport": "stdio",
            },
        }

        # Add CC server if needed
        if "cc" in self.retrieval_types:
            servers["claude-context"] = {
                # "command": "node",
                # "args": [str(project_path / "packages/mcp/dist/index.js")],  # For development environment
                "command": "npx",
                "args": ["-y", "@zilliz/claude-context-mcp@0.1.0"],  # For reproduction environment
                "env": {
                    "OPENAI_API_KEY": os.getenv("OPENAI_API_KEY"),
                    "MILVUS_ADDRESS": os.getenv("MILVUS_ADDRESS"),
                    "EMBEDDING_BATCH_SIZE": os.getenv("EMBEDDING_BATCH_SIZE", "100"),
                },
                "transport": "stdio",
            }

        # Add Grep server if needed
        if "grep" in self.retrieval_types:
            servers["grep"] = {
                "command": sys.executable,
                "args": [str(evaluation_path / "servers/grep_server.py"),],
                "transport": "stdio",
            }

        return MultiServerMCPClient(servers)

    @asynccontextmanager
    async def mcp_sessions_context(self):
        """Context manager for MCP sessions and tools loading"""
        # Build session context based on retrieval types
        session_names = ["filesystem", "edit"]

        # Add CC session if needed
        if "cc" in self.retrieval_types:
            session_names.append("claude-context")

        # Add Grep session if needed
        if "grep" in self.retrieval_types:
            session_names.append("grep")

        # Create the appropriate context manager based on which sessions we need
        if len(session_names) == 2:  # filesystem + edit
            async with self.mcp_client.session(
                "filesystem"
            ) as fs_session, self.mcp_client.session("edit") as edit_session:
                sessions = {
                    "filesystem": fs_session,
                    "edit": edit_session,
                }
                yield await self._load_tools_from_sessions(sessions)
        elif len(session_names) == 3:
            if "claude-context" in session_names:
                async with self.mcp_client.session(
                    "filesystem"
                ) as fs_session, self.mcp_client.session(
                    "edit"
                ) as edit_session, self.mcp_client.session(
                    "claude-context"
                ) as cc_session:
                    sessions = {
                        "filesystem": fs_session,
                        "edit": edit_session,
                        "claude-context": cc_session,
                    }
                    yield await self._load_tools_from_sessions(sessions)
            else:  # grep
                async with self.mcp_client.session(
                    "filesystem"
                ) as fs_session, self.mcp_client.session(
                    "edit"
                ) as edit_session, self.mcp_client.session(
                    "grep"
                ) as grep_session:
                    sessions = {
                        "filesystem": fs_session,
                        "edit": edit_session,
                        "grep": grep_session,
                    }
                    yield await self._load_tools_from_sessions(sessions)
        else:  # all 4 sessions
            async with self.mcp_client.session(
                "filesystem"
            ) as fs_session, self.mcp_client.session(
                "edit"
            ) as edit_session, self.mcp_client.session(
                "claude-context"
            ) as cc_session, self.mcp_client.session(
                "grep"
            ) as grep_session:
                sessions = {
                    "filesystem": fs_session,
                    "edit": edit_session,
                    "claude-context": cc_session,
                    "grep": grep_session,
                }
                yield await self._load_tools_from_sessions(sessions)

    async def _load_tools_from_sessions(self, sessions: Dict):
        """Load tools from the provided sessions"""
        fs_tools = await load_mcp_tools(sessions["filesystem"])
        edit_tools = await load_mcp_tools(sessions["edit"])

        # Get basic tools
        edit_tool = next((tool for tool in edit_tools if tool.name == "edit"), None,)

        # Start with filesystem tools
        search_tools = [
            tool
            for tool in fs_tools
            if tool.name in ["read_file", "list_directory", "directory_tree"]
        ]

        # Add edit tool
        if edit_tool:
            search_tools.append(edit_tool)

        # Initialize CC-specific tools
        cc_tools = {
            "index_tool": None,
            "indexing_status_tool": None,
            "clear_index_tool": None,
            "search_code_tool": None,
        }

        # Load CC tools if needed
        if "cc" in self.retrieval_types and "claude-context" in sessions:
            cc_tool_list = await load_mcp_tools(sessions["claude-context"])

            cc_tools["index_tool"] = next(
                (tool for tool in cc_tool_list if tool.name == "index_codebase"), None
            )
            cc_tools["indexing_status_tool"] = next(
                (tool for tool in cc_tool_list if tool.name == "get_indexing_status"),
                None,
            )
            cc_tools["clear_index_tool"] = next(
                (tool for tool in cc_tool_list if tool.name == "clear_index"), None
            )
            cc_tools["search_code_tool"] = next(
                (tool for tool in cc_tool_list if tool.name == "search_code"), None
            )

            # Add search code tool to search tools
            if cc_tools["search_code_tool"]:
                search_tools.append(cc_tools["search_code_tool"])

        # Load Grep tools if needed
        if "grep" in self.retrieval_types and "grep" in sessions:
            grep_tools = await load_mcp_tools(sessions["grep"])

            # Add grep tool (typically the first one is search_text)
            if grep_tools:
                search_tools.append(grep_tools[0])

        # Return tools as a dictionary for easy access
        return {
            "search_tools": search_tools,
            **cc_tools,
        }

    def build_index(self, repo_path: str) -> Any:
        asyncio.run(self.async_build_index(repo_path))

    async def async_build_index(self, repo_path: str) -> Any:
        """Build index only if CC is enabled"""
        if "cc" not in self.retrieval_types:
            return

        async with self.mcp_sessions_context() as tools:
            index_tool = tools["index_tool"]
            indexing_status_tool = tools["indexing_status_tool"]
            clear_index_tool = tools["clear_index_tool"]

            if not index_tool or not indexing_status_tool or not clear_index_tool:
                raise RuntimeError("CC tools not found in MCP sessions")

            try:
                await index_tool.ainvoke(
                    {
                        "path": repo_path,
                        "force": False,
                        "splitter": "ast",
                        "customExtensions": [],
                        "ignorePatterns": [],
                    }
                )
                while True:
                    status = await indexing_status_tool.ainvoke({"path": repo_path,})
                    if "fully indexed and ready for search" in status:
                        break
                    time.sleep(2)
                # For strong consistency, wait for a while before searching
                time.sleep(5)
            except Exception as e:
                logger.error(f"Error building index: {e}")
                logger.error(traceback.format_exc())
                await clear_index_tool.ainvoke(
                    {"path": repo_path,}
                )
                # For strong consistency, wait for a while before searching
                time.sleep(5)
                logger.info(f"Cleared index for {repo_path}")
                raise e

    def search(self, repo_path: str, issue: str, k: int = 20) -> tuple:
        return asyncio.run(self.async_search(repo_path, issue, k))

    async def async_search(self, repo_path: str, issue: str, k: int = 20) -> tuple:
        async with self.mcp_sessions_context() as tools:
            search_tools = tools["search_tools"]
            evaluator = Evaluator(self.llm_model, search_tools)
            query = self.prompt.format(repo_path=repo_path, issue=issue)

            try:
                (
                    conversation_summary,
                    token_usage,
                    file_paths,
                    tool_stats,
                ) = await evaluator.async_run(query, repo_path)
            finally:
                # Clear index if CC is enabled
                if "cc" in self.retrieval_types:
                    clear_index_tool = tools["clear_index_tool"]
                    if clear_index_tool:
                        try:
                            await clear_index_tool.ainvoke(
                                {"path": repo_path,}
                            )
                            # For strong consistency, wait for a while before searching
                            time.sleep(3)
                            logger.info(f"Cleared index for {repo_path}")
                        except Exception as clear_error:
                            logger.warning(
                                f"Failed to clear index for {repo_path}: {clear_error}"
                            )

            return file_paths, token_usage, conversation_summary, tool_stats

    def run(self, root_dir: str, token: str = "git") -> None:
        asyncio.run(self.async_run(root_dir, token))

    async def async_run(self, root_dir: str, token: str = "git") -> None:
        for instance in tqdm(self.instances, desc="Running retrieval"):
            instance_id = instance["instance_id"]
            repo = instance["repo"]
            commit = instance["base_commit"]
            issue = instance["problem_statement"]

            # Create instance directory
            instance_dir = os.path.join(self.output_dir, instance_id)
            os.makedirs(instance_dir, exist_ok=True)

            try:
                repo_dir = clone_repo(repo, root_dir, token)

                with ContextManager(str(repo_dir), commit):
                    logger.info(f"Building index for {instance_id}")
                    await self.async_build_index(str(repo_dir))

                    logger.info(f"Searching for {instance_id}")
                    (
                        hits,
                        token_usage,
                        conversation_summary,
                        tool_stats,
                    ) = await self.async_search(repo_dir, issue, k=20)

                # Extract oracle files from patch
                oracles = extract_oracle_files_from_patch(instance.get("patch", ""))

                # Prepare result data
                result = {
                    "instance_id": instance_id,
                    "hits": hits,
                    "oracles": oracles,
                    "token_usage": token_usage,
                    "tool_stats": tool_stats,
                    "retrieval_types": self.retrieval_types,  # Add info about which retrieval types were used
                }

                # Save result and token info to JSON file
                result_file = os.path.join(instance_dir, "result.json")
                with open(result_file, "w") as f:
                    json.dump(result, f, indent=2)

                # Save conversation log
                log_file = os.path.join(instance_dir, "conversation.log")
                with open(log_file, "w") as f:
                    f.write(conversation_summary)

                # Create unified diff file from conversation log
                try:
                    create_unified_diff_file(instance_dir, conversation_summary)
                    logger.info(f"Created unified diff file for {instance_id}")
                except Exception as e:
                    logger.warning(
                        f"Failed to create unified diff file for {instance_id}: {e}"
                    )

                logger.info(
                    f"Retrieval completed for {instance_id}. Results saved to {instance_dir}"
                )

            except Exception as e:
                # Save error stack trace to error.log
                error_file = os.path.join(instance_dir, "error.log")
                with open(error_file, "w") as f:
                    f.write(f"Error processing {instance_id}: {e}\n\n")
                    f.write(traceback.format_exc())

                logger.error(f"Error processing {instance_id}: {e}")
                logger.error(traceback.format_exc())
                continue
