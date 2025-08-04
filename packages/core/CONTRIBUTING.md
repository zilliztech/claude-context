# Contributing to @zilliz/claude-context-core

Thanks for your interest in contributing to the Claude Context core package!

> 📖 **First time contributing?** Please read the [main contributing guide](../../CONTRIBUTING.md) first for general setup and workflow.

## Core Package Development

This guide covers development specific to the core indexing engine.

## Development Workflow

### Quick Commands
```bash
# Build core package
pnpm build:core

# Watch mode for development
pnpm dev:core
```

### Making Changes

1. Create a new branch for your feature/fix
2. Make your changes in the `src/` directory
3. Follow the commit guidelines in the [main guide](../../CONTRIBUTING.md)

## Project Structure

- `src/context.ts` - Main Claude Context class
- `src/embedding/` - Embedding providers (OpenAI, VoyageAI, Ollama)
- `src/vectordb/` - Vector database implementations (Milvus)
- `src/splitter/` - Code splitting logic
- `src/types.ts` - TypeScript type definitions

## Guidelines

- Use TypeScript strict mode
- Follow existing code style
- Handle errors gracefully

## Questions?

- **General questions**: See [main contributing guide](../../CONTRIBUTING.md)
- **Core-specific issues**: Open an issue with the `core` label 