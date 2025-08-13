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
from utils.format import extract_oracle_files_from_patch, create_edit_subdirectories
import json
import os
import traceback
from tqdm.auto import tqdm
from typing import List, Dict, Any


from utils.file_management import ContextManager, clone_repo

logger = logging.getLogger(__name__)


class CCRetrieval(BaseRetrieval):
    def __init__(
        self,
        llm_type: str,
        llm_model: str,
        *,
        dataset_name_or_path,
        splits,
        output_dir,
        **kwargs,
    ):
        super().__init__(
            dataset_name_or_path=dataset_name_or_path,
            splits=splits,
            output_dir=output_dir,
            **kwargs,
        )
        self.llm_model = llm_factory(llm_type, llm_model)
        self.mcp_client = MultiServerMCPClient(
            {
                "filesystem": {
                    "command": "npx",
                    "args": [
                        "-y",
                        "@modelcontextprotocol/server-filesystem",
                        str(project_path),
                    ],
                    "transport": "stdio",
                },
                "claude-context": {
                    "command": "node",
                    "args": [str(project_path / "packages/mcp/dist/index.js")],
                    "env": {
                        "OPENAI_API_KEY": os.getenv("OPENAI_API_KEY"),
                        "MILVUS_ADDRESS": "10.100.30.11:19530",
                        "EMBEDDING_BATCH_SIZE": "512",
                    },
                    "transport": "stdio",
                },
                "edit": {
                    "command": sys.executable,
                    "args": [
                        str(evaluation_path / "servers/edit_server.py"),
                    ],
                    "transport": "stdio",
                },
            }
        )

    @asynccontextmanager
    async def mcp_sessions_context(self):
        """Context manager for MCP sessions and tools loading"""
        async with (
            self.mcp_client.session("claude-context") as cc_session,
            self.mcp_client.session("filesystem") as fs_session,
            self.mcp_client.session("edit") as edit_session,
        ):
            # Load tools from each session
            cc_tools = await load_mcp_tools(cc_session)
            fs_tools = await load_mcp_tools(fs_session)
            edit_tools = await load_mcp_tools(edit_session)

            # Extract specific tools
            index_tool = next(
                (tool for tool in cc_tools if tool.name == "index_codebase"), None
            )
            indexing_status_tool = next(
                (tool for tool in cc_tools if tool.name == "get_indexing_status"), None
            )
            clear_index_tool = next(
                (tool for tool in cc_tools if tool.name == "clear_index"), None
            )
            search_code_tool = next(
                (tool for tool in cc_tools if tool.name == "search_code"), None
            )
            edit_tool = next(
                (tool for tool in edit_tools if tool.name == "edit"),
                None,
            )

            # Combine search tools
            search_tools = (
                [
                    tool
                    for tool in fs_tools
                    if tool.name in ["read_file", "list_directory", "directory_tree"]
                ]
                + ([search_code_tool] if search_code_tool else [])
                + ([edit_tool] if edit_tool else [])
            )

            # Yield tools as a dictionary for easy access
            yield {
                "index_tool": index_tool,
                "indexing_status_tool": indexing_status_tool,
                "clear_index_tool": clear_index_tool,
                "search_tools": search_tools,
            }

    def build_index(self, repo_path: str) -> Any:
        asyncio.run(self.async_build_index(repo_path))

    async def async_build_index(self, repo_path: str) -> Any:
        async with self.mcp_sessions_context() as tools:
            index_tool = tools["index_tool"]
            indexing_status_tool = tools["indexing_status_tool"]
            clear_index_tool = tools["clear_index_tool"]

            if not index_tool or not indexing_status_tool or not clear_index_tool:
                raise RuntimeError("Required tools not found in MCP sessions")

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
                    status = await indexing_status_tool.ainvoke(
                        {
                            "path": repo_path,
                        }
                    )
                    if "fully indexed and ready for search" in status:
                        break
                    time.sleep(2)
                # For strong consistency, wait for a while before searching
                time.sleep(5)
            except Exception as e:
                logger.error(f"Error building index: {e}")
                logger.error(traceback.format_exc())
                await clear_index_tool.ainvoke(
                    {
                        "path": repo_path,
                    }
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
                conversation_summary, token_usage, file_paths, tool_stats = (
                    await evaluator.async_run(query, repo_path)
                )
            finally:
                # Always clear index to avoid sync in the background, even if search fails
                clear_index_tool = tools["clear_index_tool"]
                try:
                    await clear_index_tool.ainvoke(
                        {
                            "path": repo_path,
                        }
                    )
                    # For strong consistency, wait for a while before searching
                    time.sleep(3)
                    logger.info(f"Cleared index for {repo_path}")
                except Exception as clear_error:
                    logger.warning(f"Failed to clear index for {repo_path}: {clear_error}")
            
            return file_paths, token_usage, conversation_summary, tool_stats

    def run(self, root_dir: str, token: str = "git") -> None:
        asyncio.run(self.async_run(root_dir, token))

    async def async_run(self, root_dir: str, token: str = "git") -> None:
        for instance in tqdm(self.instances, desc="Running retrieval"):
            instance_id = instance["instance_id"]
            repo = instance["repo"]
            commit = instance["base_commit"]
            issue = instance["problem_statement"]

            try:
                repo_dir = clone_repo(repo, root_dir, token)

                with ContextManager(str(repo_dir), commit):
                    logger.info(f"Building index for {instance_id}")
                    await self.async_build_index(str(repo_dir))

                    logger.info(f"Searching for {instance_id}")
                    hits, token_usage, conversation_summary, tool_stats = (
                        await self.async_search(repo_dir, issue, k=20)
                    )

                # Create instance directory
                instance_dir = os.path.join(self.output_dir, instance_id)
                os.makedirs(instance_dir, exist_ok=True)

                # Extract oracle files from patch
                oracles = extract_oracle_files_from_patch(instance.get("patch", ""))

                # Prepare result data
                result = {
                    "instance_id": instance_id,
                    "hits": hits,
                    "oracles": oracles,
                    "token_usage": token_usage,
                    "tool_stats": tool_stats,
                }

                # Save result and token info to JSON file
                result_file = os.path.join(instance_dir, "result.json")
                with open(result_file, "w") as f:
                    json.dump(result, f, indent=2)

                # Save conversation log
                log_file = os.path.join(instance_dir, "conversation.log")
                with open(log_file, "w") as f:
                    f.write(conversation_summary)

                # Create edit subdirectories from conversation log
                try:
                    create_edit_subdirectories(instance_dir, conversation_summary)
                    logger.info(f"Created edit subdirectories for {instance_id}")
                except Exception as e:
                    logger.warning(
                        f"Failed to create edit subdirectories for {instance_id}: {e}"
                    )

                logger.info(
                    f"Retrieval completed for {instance_id}. Results saved to {instance_dir}"
                )

            except Exception as e:
                logger.error(f"Error processing {instance_id}: {e}")
                logger.error(traceback.format_exc())
                continue
