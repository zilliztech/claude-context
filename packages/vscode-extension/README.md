# Semantic Code Search VSCode Extension

A code indexing and semantic search VSCode extension powered by CodeIndexer.

> 📖 **New to CodeIndexer?** Check out the [main project README](../../README.md) for an overview and setup instructions.

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/zilliz.semanticcodesearch?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)

## Features

- 🔍 **Semantic Search**: Intelligent code search based on semantic understanding, not just keyword matching
- 📁 **Codebase Indexing**: Automatically index entire codebase and build semantic vector database
- 🎯 **Context Search**: Search related code by selecting code snippets
- 🔧 **Multi-platform Support**: Support for OpenAI and VoyageAI as embedding providers
- 💾 **Vector Storage**: Integrated with Milvus vector database for efficient storage and retrieval

## Installation

### From VS Code Marketplace

1. **Direct Link**: [Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)

2. **Manual Search**:
   - Open Extensions view in VSCode (Ctrl+Shift+X or Cmd+Shift+X on Mac)
   - Search for "Semantic Code Search"
   - Click Install

## Quick Start

1. **Configure Embedding Model**:
   - Open VSCode Settings (Ctrl+, or Cmd+, on Mac)
   - Search for "Semantic Code Search"
   - Configure embedding provider and API Key

2. **Index Codebase**:
   - Open Command Palette (Ctrl+Shift+P or Cmd+Shift+P on Mac)
   - Run "Semantic Code Search: Index Codebase"

3. **Start Searching**:
   - Open Semantic Code Search panel in sidebar
   - Enter search query or right-click on selected code to search

## Commands

- `Semantic Code Search: Semantic Search` - Perform semantic search
- `Semantic Code Search: Index Codebase` - Index current codebase
- `Semantic Code Search: Clear Index` - Clear the index

## Configuration

- `semanticCodeSearch.embeddingProvider.provider` - Embedding provider (OpenAI/VoyageAI)
- `semanticCodeSearch.embeddingProvider.model` - Embedding model to use
- `semanticCodeSearch.embeddingProvider.apiKey` - API key for embedding provider
- `semanticCodeSearch.milvus.address` - Milvus server address

## Contributing

This VSCode extension is part of the CodeIndexer monorepo. Please see:
- [Main Contributing Guide](../../CONTRIBUTING.md) - General contribution guidelines
- [VSCode Extension Contributing](CONTRIBUTING.md) - Specific development guide for this extension

## Related Packages

- **[@code-indexer/core](../core)** - Core indexing engine used by this extension
- **[@code-indexer/mcp](../mcp)** - Alternative MCP server integration

## Tech Stack

- TypeScript
- VSCode Extension API  
- Milvus Vector Database
- OpenAI/VoyageAI Embeddings

## License

MIT - See [LICENSE](../../LICENSE) for details 