#!/usr/bin/env python3
"""
Test script for the Evaluator class
"""

import asyncio
import os
from pathlib import Path
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama
from client import Evaluator
from utils.constant import evaluation_path, project_path


async def get_mcp_tools():
    """Get MCP tools from the claude-context server"""

    client = MultiServerMCPClient(
        {
            "math": {
                "command": "python",
                "args": [str(evaluation_path / "servers" / "math_server.py")],
                "transport": "stdio",
            },
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
        }
    )
    tools = await client.get_tools()
    # filter tools by name
    tools = [
        tool
        for tool in tools
        if tool.name
        in [
            "read_file",
            "list_directory",
            "directory_tree",
            "search_code",
        ]
    ]
    print(f"🔧 Available tools: {[tool.name for tool in tools]}")
    return tools


def test_evaluator():
    """Test the Evaluator class"""
    print("🧮 Testing Evaluator Class")
    print("=" * 60)

    # Get tools first
    tools = asyncio.run(get_mcp_tools())

    # Create model
    # model = ChatOllama(model="gpt-oss:20b", base_url="http://10.100.30.11:11434")
    # model = ChatOpenAI(model="gpt-4o-mini")
    model = ChatOpenAI(
        model="kimi-k2-0711-preview",
        base_url="https://api.moonshot.cn/v1",
        api_key=os.getenv("MOONSHOT_API_KEY"),
    )

    # Create evaluator with required parameters (event loop setup is handled in __init__)
    evaluator = Evaluator(llm_model=model, tools=tools)

    # Test query
    # query = "what's (3123 + 51341/31) x 2123? use tools to calculate"
    codebase_statement = f"""
    You are answering a question about the current codebase, and the path of the current codebase is {project_path}.
    """
    issue = f"list the files in the evaluation/ directory, use filesystem tool."
    query = codebase_statement + "\n" + issue

    response = evaluator.run(query)

    print("\n" + "=" * 60)
    print("🎉 Test completed successfully!")
    print("=" * 60)

    return response


if __name__ == "__main__":
    test_evaluator()
