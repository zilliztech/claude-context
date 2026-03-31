# @lbruton/claude-context

> Actively maintained fork of [zilliztech/claude-context](https://github.com/zilliztech/claude-context) — hardened for self-hosted Milvus deployments.

## Why this fork?

The upstream `@zilliz/claude-context-mcp` is built for Zilliz Cloud. When used with self-hosted Milvus, it has several issues:

- **No fetch timeout** on REST API calls — hangs indefinitely on `DEADLINE_EXCEEDED`
- **No gRPC connection timeout** — `MilvusClient` connects without a timeout, causing session startup failures
- **No error differentiation** — transient vs permanent failures are treated identically
- **Carries unused packages** — chrome extension, VS Code extension, and Python evaluation suite add attack surface without value for MCP-only deployments

This fork strips it down to the essentials (core + MCP server), patches vulnerabilities, and publishes to `@lbruton/claude-context-mcp` on npm.

## Changes from upstream

### Stability fixes
1. **30s fetch timeout** on all REST API requests (`AbortSignal.timeout`)
2. **30s gRPC connection timeout** on `MilvusClient` initialization
3. **Better error logging** — timeout vs error differentiated in log output

### Security hardening (0.1.8)
4. **Removed unused packages** — chrome extension, VS Code extension, and `evaluation/` benchmark suite eliminated along with their vulnerable dependency trees
5. **Patched all dependencies** — 67 audit vulnerabilities resolved (0 remaining)
6. **pnpm overrides** for transitive deps pinned by upstream packages (`@langchain/core`, `langsmith`, `qs`)
7. **Codacy SCA/SAST clean** — `.codacy.yml` configured, false positives suppressed

### Scope
8. **Rebranded to `@lbruton/` npm scope** — `@lbruton/claude-context-core` + `@lbruton/claude-context-mcp`
9. **Lean monorepo** — only `packages/core` and `packages/mcp` remain in the workspace

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
| `MILVUS_TOKEN` | No | Zilliz Cloud token (not needed for local Milvus) |

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

Original project by [Zilliz](https://zilliz.com): [zilliztech/claude-context](https://github.com/zilliztech/claude-context). This fork diverges in scope (MCP-only, self-hosted Milvus) but the core indexing engine and MCP protocol implementation remain theirs.
