# @code-indexer/mcp

Model Context Protocol (MCP) integration for CodeIndexer - A powerful MCP server that enables AI assistants and agents to index and search codebases using semantic search.

[![npm version](https://img.shields.io/npm/v/@code-indexer/mcp.svg)](https://www.npmjs.com/package/@code-indexer/mcp)
[![npm downloads](https://img.shields.io/npm/dm/@code-indexer/mcp.svg)](https://www.npmjs.com/package/@code-indexer/mcp)

> 📖 **New to CodeIndexer?** Check out the [main project README](../../README.md) for an overview and setup instructions.

## What is MCP?

The Model Context Protocol (MCP) is an open protocol that standardizes how AI applications can securely connect to and interact with data sources and tools. This package provides an MCP server that exposes CodeIndexer's semantic search capabilities to any MCP-compatible client.

## Features

- **🔌 MCP Protocol Compliance**: Full compatibility with MCP-enabled AI assistants and agents
- **🔍 Semantic Code Search**: Natural language queries to find relevant code snippets
- **📁 Codebase Indexing**: Index entire codebases for fast semantic search
- **🔄 Auto-Sync**: Automatically detects and synchronizes file changes to keep index up-to-date
- **🧠 AI-Powered**: Uses OpenAI embeddings and Milvus vector database
- **⚡ Real-time**: Interactive indexing and searching with progress feedback
- **🛠️ Tool-based**: Exposes three main tools via MCP protocol

## Available Tools

### 1. `index_codebase`
Index a codebase directory for semantic search.

**Parameters:**
- `path` (required): Path to the codebase directory to index
- `force` (optional): Force re-indexing even if already indexed (default: false)

### 2. `search_code`
Search the indexed codebase using natural language queries.

**Parameters:**
- `query` (required): Natural language query to search for in the codebase
- `limit` (optional): Maximum number of results to return (default: 10, max: 50)

### 3. `clear_index`
Clear the search index.

**Parameters:**
- `confirm` (required): Confirmation flag to prevent accidental clearing

## Installation

```bash
npm install @code-indexer/mcp
```

Or run directly with npx:

```bash
npx @code-indexer/mcp@latest
```

## Quick Start

### Prerequisites

Before using the MCP server, make sure you have:
- OpenAI API Key  
- Milvus vector database (local or cloud)

> 💡 **Setup Help:** See the [main project setup guide](../../README.md#-quick-start) for detailed installation instructions.

### Environment Variables

```bash
# Required
OPENAI_API_KEY=your_openai_api_key

# Optional (with defaults)
MILVUS_ADDRESS=localhost:19530
MILVUS_TOKEN=your_milvus_token  # Only needed for cloud Milvus
MCP_SERVER_NAME="CodeIndexer MCP Server"
MCP_SERVER_VERSION="1.0.0"
```

## Usage with MCP Clients

### Claude Desktop

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "code-indexer": {
      "command": "npx",
      "args": ["@code-indexer/mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```

### Other MCP Clients

The server uses stdio transport and follows the standard MCP protocol. It can be integrated with any MCP-compatible client by running:

```bash
npx @code-indexer/mcp@latest
```

## Contributing

This package is part of the CodeIndexer monorepo. Please see:
- [Main Contributing Guide](../../CONTRIBUTING.md) - General contribution guidelines  
- [MCP Package Contributing](CONTRIBUTING.md) - Specific development guide for this package

## Related Projects

- **[@code-indexer/core](../core)** - Core indexing engine used by this MCP server
- **[VSCode Extension](../vscode-extension)** - Alternative VSCode integration
- [Model Context Protocol](https://modelcontextprotocol.io/) - Official MCP documentation

## License

MIT - See [LICENSE](../../LICENSE) for details 