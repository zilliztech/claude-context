# @lbruton/claude-context

> Fork of [zilliztech/claude-context](https://github.com/zilliztech/claude-context) — patched for local Milvus stability.

## Why this fork?

The upstream `@zilliz/claude-context-mcp` has recurring issues with local Milvus deployments:

- **No fetch timeout** on REST API calls — hangs indefinitely on `DEADLINE_EXCEEDED`
- **No gRPC connection timeout** — `MilvusClient` connects without a timeout, causing session startup failures
- **No error differentiation** — transient vs permanent failures are treated identically
- **`npx @latest` re-downloads every session** — pulls the buggy upstream on each new Claude Code session

This fork fixes those issues and publishes to `@lbruton/claude-context-mcp` on npm so sessions always use the patched version.

## Changes from upstream

1. **30s fetch timeout** on all REST API requests (`AbortSignal.timeout`)
2. **30s gRPC connection timeout** on `MilvusClient` initialization
3. **Better error logging** — timeout vs error differentiated in log output
4. **Rebranded to `@lbruton/` npm scope** — `@lbruton/claude-context-core` + `@lbruton/claude-context-mcp`

## Installation (Claude Code MCP)

In `~/.claude/.mcp.json`:

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["-y", "@lbruton/claude-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "EMBEDDING_PROVIDER": "OpenAI",
        "EMBEDDING_MODEL": "text-embedding-3-small",
        "MILVUS_ADDRESS": "192.168.1.81:19530"
      },
      "startupTimeoutMs": 30000
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MILVUS_ADDRESS` | Yes | Milvus gRPC endpoint (e.g., `localhost:19530`) |
| `OPENAI_API_KEY` | Yes* | OpenAI API key for embeddings |
| `EMBEDDING_PROVIDER` | No | `OpenAI` (default), `VoyageAI`, `Gemini`, `Ollama` |
| `EMBEDDING_MODEL` | No | Model name (default: `text-embedding-3-small`) |
| `MILVUS_TOKEN` | No | Milvus authentication token (optional) |

*Required when using OpenAI embeddings (default).

## Local Milvus Setup

This fork is designed for local Milvus Standalone. Run Milvus via Docker:

```bash
# Milvus Standalone (includes etcd + minio)
docker compose -f docker-compose-milvus.yml up -d
```

Or use an existing Milvus instance on your network — just set `MILVUS_ADDRESS` to point to it.

## Building from source

```bash
pnpm install
pnpm build:core
pnpm build:mcp
```

## Publishing

```bash
pnpm release:core
pnpm release:mcp
```

## License

MIT — same as upstream.

## Upstream

Original project: [zilliztech/claude-context](https://github.com/zilliztech/claude-context)
