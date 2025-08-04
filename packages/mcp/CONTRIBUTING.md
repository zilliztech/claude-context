# Contributing to @zilliz/claude-context-mcp

Thanks for your interest in contributing to the Claude Context MCP server!

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
See [README.md](./README.md#prepare-environment-variables) for required environment variables.

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
   - `index_codebase` - Index a sample codebase with optional custom ignore patterns
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

## Tool Parameters

### `index_codebase`
- `path` (required): Path to the codebase directory
- `force` (optional): Force re-indexing even if already indexed (default: false)
- `splitter` (optional): Code splitter type - 'ast' or 'langchain' (default: 'ast')  
- `ignorePatterns` (optional): Additional ignore patterns to add to defaults (default: [])
  - Examples: `["static/**", "*.tmp", "private/**", "docs/generated/**"]`
  - Merged with default patterns (node_modules, .git, etc.)

### `search_code`
- `path` (required): Path to the indexed codebase
- `query` (required): Natural language search query
- `limit` (optional): Maximum number of results (default: 10, max: 50)

### `clear_index`
- `path` (required): Path to the codebase to clear

## Guidelines

- Keep tool interfaces simple and intuitive
- Provide clear error messages
- Validate all user inputs
- Use TypeScript for type safety

## Working with MCP Clients

### Cursor/Claude Desktop Development Mode Configuration
You can use the following configuration to configure the MCP server with a development mode.
```json
{
  "mcpServers": {
    "claude-context-local": {
      "command": "node",
      "args": ["PATH_TO_CLAUDECONTEXT/packages/mcp/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-your-openai-api-key",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

### Claude Code Development Mode Configuration
```bash
claude mcp add claude-context -e OPENAI_API_KEY=sk-your-openai-api-key -e MILVUS_TOKEN=your-zilliz-cloud-api-key -- node PATH_TO_CLAUDECONTEXT/packages/mcp/dist/index.js
```
And then you can start Claude Code with `claude --debug` to see the MCP server logs.

### Manual Usage
Use all three MCP tools:
- `index_codebase` - Index sample repositories with optional custom ignore patterns  
  Example with ignore patterns: `{"path": "/repo/path", "ignorePatterns": ["static/**", "*.tmp"]}`
- `search_code` - Search with various queries  
- `clear_index` - Clear and re-index

## Questions?

- **General questions**: See [main contributing guide](../../CONTRIBUTING.md)
- **MCP-specific issues**: Open an issue with the `mcp` label 