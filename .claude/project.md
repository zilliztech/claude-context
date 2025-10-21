# Claude Context Project

## Overview
Claude Context is an MCP plugin that adds semantic code search to Claude Code and other AI coding agents, giving them deep context from entire codebases.

## Key Features
- 🧠 Semantic code search using vector embeddings
- 💰 Cost-effective for large codebases
- ⚡ Incremental indexing with Merkle trees
- 🧩 Intelligent AST-based code chunking
- 🗄️ Scalable with Zilliz Cloud vector database

## Project Structure
This is a pnpm monorepo with the following packages:

### packages/core
Core indexing engine with embedding and vector database integration.
- TypeScript library
- Supports multiple embedding providers (OpenAI, VoyageAI, Ollama, Gemini)
- AST-based code splitting
- Incremental indexing

### packages/mcp
Model Context Protocol server for AI agent integration.
- Provides MCP tools: index_codebase, search_code, clear_index, get_indexing_status
- Compatible with Claude Code, Cursor, VSCode, and other MCP clients

### packages/vscode-extension
Visual Studio Code extension for semantic code search.
- Direct IDE integration
- Intuitive search interface

### packages/chrome-extension
Chrome extension (in development).

## Tech Stack
- **Language**: TypeScript 5.8+
- **Runtime**: Node.js 20.x or 22.x
- **Package Manager**: pnpm 10+
- **Build**: TypeScript compiler, webpack
- **Testing**: Jest
- **Linting**: ESLint with TypeScript plugin
- **CI/CD**: GitHub Actions
- **Vector DB**: Milvus / Zilliz Cloud

## Development Workflow
1. Make changes to source files
2. Run `pnpm dev` for watch mode
3. Run `pnpm lint` to check code style
4. Run `pnpm typecheck` to verify types
5. Run `pnpm build` to build packages
6. Run `pnpm test` to run tests
7. Commit changes (pre-commit hooks run automatically)

## Release Process
Releases are automated through GitHub Actions:
- Create git tag (v* for stable, c* for canary)
- Push tag to trigger release workflow
- Packages published to npm
- VSCode extension published to marketplace

## Important Files
- `pnpm-workspace.yaml` - Workspace configuration
- `tsconfig.json` - TypeScript configuration
- `.eslintrc.js` - ESLint configuration
- `.github/workflows/ci.yml` - CI pipeline
- `.github/workflows/release.yml` - Release automation
