# Semantic Code Search VSCode Extension

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/zilliz.semanticcodesearch?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)

A code indexing and semantic search VSCode extension powered by Code Context.

> 📖 **New to Code Context?** Check out the [main project README](../../README.md) for an overview and setup instructions.


![img](https://lh7-rt.googleusercontent.com/docsz/AD_4nXddRXEWLX9uzbAZa9FgHo77leAgYneIclqWObTM9To_Deo4fBIOZFrsM8_IVjCnJQeuOO1FgtI_IFj9S8MWnUX3aej98QvhlGrCbGALQ-d2c0DgyJEj3-Nsg-ufX39-951DamHmkA?key=_L-CtW461S9w7NRqzdFOIg)

## Features

- 🔍 **Semantic Search**: Intelligent code search based on semantic understanding, not just keyword matching
- 📁 **Codebase Indexing**: Automatically index entire codebase and build semantic vector database
- 🎯 **Context Search**: Search related code by selecting code snippets
- 🔧 **Multi-platform Support**: Support for OpenAI, VoyageAI, Gemini, and Ollama as embedding providers
- 💾 **Vector Storage**: Integrated with Milvus vector database for efficient storage and retrieval

## Requirements

- **VSCode Version**: 1.74.0 or higher

## Installation

### From VS Code Marketplace

1. **Direct Link**: [Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)

2. **Manual Search**:
   - Open Extensions view in VSCode (Ctrl+Shift+X or Cmd+Shift+X on Mac)
   - Search for "Semantic Code Search"
   - Click Install

## Quick Start

### Configuration
The first time you open Code Context, you need to click on Settings icon to configure the relevant options.

#### Embedding Configuration
Configure your embedding provider to convert code into semantic vectors.

**OpenAI Configuration:**
- `Embedding Provider`: Select "OpenAI" from the dropdown
- `Model name`: Choose the embedding model (e.g., `text-embedding-3-small`, `text-embedding-3-large`)
- `OpenAI API key`: Your OpenAI API key for authentication
- `Custom API endpoint URL`: Optional custom endpoint (defaults to `https://api.openai.com/v1`)

**Other Supported Providers:**
- **Gemini**: Google's state-of-the-art embedding model with Matryoshka representation learning
- **VoyageAI**: Alternative embedding provider with competitive performance  
- **Ollama**: For local embedding models

#### Code Splitter Configuration
Configure how your code is split into chunks for indexing.

**Splitter Settings:**
- `Splitter Type`: Choose between "AST Splitter" (syntax-aware) or "LangChain Splitter" (character-based)
- `Chunk Size`: Maximum size of each code chunk (default: 1000 characters)
- `Chunk Overlap`: Number of overlapping characters between chunks (default: 200 characters)

> **Recommendation**: Use AST Splitter for better semantic understanding of code structure.


#### Zilliz Cloud configuration
Get a free Milvus vector database on Zilliz Cloud. 

Code Context needs a vector database. You can [sign up](https://cloud.zilliz.com/signup) on Zilliz Cloud to get a free Serverless cluster.

![](../../assets/signup_and_create_cluster.jpeg)

After creating your cluster, open your Zilliz Cloud console and copy both the **public endpoint** and your **API key**.  
These will be used as `your-zilliz-cloud-public-endpoint` and `your-zilliz-cloud-api-key` in the configuration examples.

![Zilliz Cloud Dashboard](../../assets/zilliz_cloud_dashboard.jpeg)

Keep both values handy for the configuration steps below.

If you need help creating your free vector database or finding these values, see the [Zilliz Cloud documentation](https://docs.zilliz.com/docs/create-cluster) for detailed instructions.

```bash
MILVUS_ADDRESS=your-zilliz-cloud-public-endpoint
MILVUS_TOKEN=your-zilliz-cloud-api-key
``` 

### Usage

1. **Set the Configuration**:
   - Open VSCode Settings (Ctrl+, or Cmd+, on Mac)
   - Search for "Semantic Code Search"
   - Set the configuration

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

- `semanticCodeSearch.embeddingProvider.provider` - Embedding provider (OpenAI/VoyageAI/Gemini/Ollama)
- `semanticCodeSearch.embeddingProvider.model` - Embedding model to use
- `semanticCodeSearch.embeddingProvider.apiKey` - API key for embedding provider
- `semanticCodeSearch.embeddingProvider.outputDimensionality` - Output dimension for Gemini (supports 3072, 1536, 768, 256)
- `semanticCodeSearch.milvus.address` - Milvus server address

## Contributing

This VSCode extension is part of the Code Context monorepo. Please see:
- [Main Contributing Guide](../../CONTRIBUTING.md) - General contribution guidelines
- [VSCode Extension Contributing](CONTRIBUTING.md) - Specific development guide for this extension

## Related Packages

- **[@zilliz/code-context-core](../core)** - Core indexing engine used by this extension
- **[@zilliz/code-context-mcp](../mcp)** - Alternative MCP server integration

## Tech Stack

- TypeScript
- VSCode Extension API  
- Milvus Vector Database
- OpenAI/VoyageAI Embeddings

## License

MIT - See [LICENSE](../../LICENSE) for details 