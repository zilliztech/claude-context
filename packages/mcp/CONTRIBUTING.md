# Contributing to @code-indexer/mcp

Thanks for your interest in contributing to the CodeIndexer MCP server!

> 📖 **First time contributing?** Please read the [main contributing guide](../../CONTRIBUTING.md) first for general setup and workflow.

## MCP Server Development

This guide covers development specific to the MCP server.

### Quick Commands
```bash
# Build MCP server
pnpm build:mcp

# Watch mode for development
pnpm dev:mcp

# Start server
pnpm start

# Run with environment variables
pnpm start:with-env
```

### Required Environment Variables
Set the following environment variables based on your chosen embedding provider.

#### OpenAI (Default)
```bash
# Required
export OPENAI_API_KEY="your-api-key"
export MILVUS_ADDRESS="localhost:19530"

# Optional
export EMBEDDING_PROVIDER="openai"
export OPENAI_MODEL="text-embedding-3-small"
```

#### Ollama
```bash
# Required
export EMBEDDING_PROVIDER="ollama"
export OLLAMA_MODEL="nomic-embed-text"
export MILVUS_ADDRESS="localhost:19530"

# Optional
export OLLAMA_HOST="http://127.0.0.1:11434"
```

## Running the MCP Server

1. Build the server:
   ```bash
   pnpm build
   ```
2. Run with MCP client or directly:
   ```bash
   pnpm start
   ```
3. Use the tools:
   - `index_codebase` - Index a sample codebase
   - `search_code` - Search for code snippets
   - `clear_index` - Clear the index

## Making Changes

1. Create a new branch for your feature/fix
2. Edit `src/index.ts` - Main MCP server implementation  
3. Verify with MCP clients (Claude Desktop, etc.)
4. Follow commit guidelines in the [main guide](../../CONTRIBUTING.md)

## MCP Protocol

- Follow [MCP specification](https://modelcontextprotocol.io/)
- Use stdio transport for compatibility
- Handle errors gracefully with proper MCP responses
- Redirect logs to stderr (not stdout)

## Guidelines

- Keep tool interfaces simple and intuitive
- Provide clear error messages
- Validate all user inputs
- Use TypeScript for type safety

## Working with MCP Clients

### Claude Desktop/Cursor Configuration
You can use the following configuration to configure the MCP server with a development mode.
```json
{
  "mcpServers": {
    "code-indexer-local": {
      "command": "node",
      "args": ["PATH_TO_CODEINDEXER/packages/mcp/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "your-key",  
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```

### Manual Usage
Use all three MCP tools:
- `index_codebase` - Index sample repositories
- `search_code` - Search with various queries  
- `clear_index` - Clear and re-index

## Questions?

- **General questions**: See [main contributing guide](../../CONTRIBUTING.md)
- **MCP-specific issues**: Open an issue with the `mcp` label 