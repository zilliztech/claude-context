# Semantic Code Search VSCode Extension

A code indexing and semantic search VSCode extension powered by CodeIndexer.

## Features

- 🔍 **Semantic Search**: Intelligent code search based on semantic understanding, not just keyword matching
- 📁 **Codebase Indexing**: Automatically index entire codebase and build semantic vector database
- 🎯 **Context Search**: Search related code by selecting code snippets
- 🔧 **Multi-platform Support**: Support for OpenAI and VoyageAI as embedding providers
- 💾 **Vector Storage**: Integrated with Milvus vector database for efficient storage and retrieval

## Installation

1. Open Extensions view in VSCode (Ctrl+Shift+X)
2. Search for "Semantic Code Search"
3. Click Install

## Quick Start

1. **Configure Embedding Model**:
   - Open VSCode Settings (Ctrl+,)
   - Search for "Semantic Code Search"
   - Configure embedding provider and API Key

2. **Index Codebase**:
   - Open Command Palette (Ctrl+Shift+P)
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

## Tech Stack

- TypeScript
- VSCode Extension API
- Milvus Vector Database
- OpenAI/VoyageAI Embeddings

## License

MIT License 