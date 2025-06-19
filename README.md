# CodeIndexer



[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/zilliz.semanticcodesearch?label=VS%20Code%20Extension&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)
[![npm - core](https://img.shields.io/npm/v/@code-indexer/core?label=%40code-indexer%2Fcore&logo=npm)](https://www.npmjs.com/package/@code-indexer/core)
[![npm - mcp](https://img.shields.io/npm/v/@code-indexer/mcp?label=%40code-indexer%2Fmcp&logo=npm)](https://www.npmjs.com/package/@code-indexer/mcp)
[![Twitter](https://img.shields.io/twitter/url/https/twitter.com/zilliz_universe.svg?style=social&label=Follow%20%40Zilliz)](https://twitter.com/zilliz_universe)
<a href="https://discord.gg/mKc3R95yE5"><img height="20" src="https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white" alt="discord"/></a>

A powerful code indexing and semantic search tool with multi-platform support. Index your entire codebase and perform intelligent semantic searches powered by vector databases and AI embeddings.

## 🌟 Why CodeIndexer?

In the **AI-first development era**, traditional keyword-based search is no longer sufficient for modern software development:

### 🚀 **The AI Coding Revolution**
- **AI-Powered IDEs** like Cursor and GitHub Copilot are transforming development workflows
- **Growing demand** for intelligent code assistance and semantic understanding
- **Modern codebases** contain millions of lines across hundreds of files, making manual navigation inefficient

### ❌ **Current Limitations**
- Regex and keyword-based search miss **contextual relationships**
- Developers waste time navigating large codebases manually  
- Knowledge transfer between team members is inefficient
- Traditional search tools can't bridge the gap between **human intent** and **code implementation**

### ✅ **Our Solution**
CodeIndexer bridges the gap between human understanding and code discovery through:
- **Semantic search** with natural language queries like *"find authentication functions"*
- **AI-powered understanding** of code meaning and relationships
- **Universal integration** across multiple platforms and development environments

> 💡 **Find code by describing functionality, not just keywords** - Discover existing solutions before writing duplicate code.

## ✨ Features

- 🔍 **Semantic Code Search**: Ask questions like *"find functions that handle user authentication"* instead of guessing keywords
- 📁 **Intelligent Indexing**: Automatically index entire codebases and build semantic vector databases with contextual understanding
- 🎯 **Context-Aware Discovery**: Find related code snippets based on meaning, not just text matching
- 🚀 **Developer Productivity**: Significantly reduce time spent searching for relevant code and discovering existing solutions
- 🔧 **Embedding Providers**: Support for OpenAI and VoyageAI as embedding providers
- 💾 **Vector Storage**: Integrated with Milvus/Zilliz Cloud for efficient storage and retrieval
- 🛠️ **VSCode Integration**: Built-in VSCode extension for seamless development workflow
- 🤖 **MCP Support**: Model Context Protocol integration for AI agent interactions
- 📊 **Progress Tracking**: Real-time progress feedback during indexing operations
- 🎨 **Customizable**: Configurable file extensions, ignore patterns, and chunk sizes

## 🏗️ Architecture
![](asserts/Architecture.png)

CodeIndexer is a monorepo containing three main packages:

### Core Components

- **`@code-indexer/core`**: Core indexing engine with embedding and vector database integration
- **VSCode Extension**: Semantic Code Search extension for Visual Studio Code
- **`@code-indexer/mcp`**: Model Context Protocol server for AI agent integration

### Supported Technologies
- **Embedding Providers**: [OpenAI](https://openai.com), [VoyageAI](https://voyageai.com)
- **Vector Databases**: [Milvus](https://milvus.io) (gRPC & RESTful API) or [Zilliz Cloud](https://zilliz.com/cloud)(fully managed vector database as a service)
- **Languages**: TypeScript, JavaScript, Python, Java, C++, C#, Go, Rust, PHP, Ruby, Swift, Kotlin, Scala, Markdown
- **Development Tools**: VSCode, Model Context Protocol

## 🚀 Quick Start

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 10.0.0
- Milvus database
- OpenAI or VoyageAI API key

### Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Basic Usage

```typescript
import { CodeIndexer, MilvusVectorDatabase } from '@code-indexer/core';

// Initialize vector database
const vectorDatabase = new MilvusVectorDatabase({
    address: 'localhost:19530'
});

// Create indexer instance
const indexer = new CodeIndexer({
    vectorDatabase,
    chunkSize: 1000,
    chunkOverlap: 200
});

// Index your codebase
const stats = await indexer.indexCodebase('./your-project');
console.log(`Indexed ${stats.indexedFiles} files, ${stats.totalChunks} chunks`);

// Perform semantic search
const results = await indexer.semanticSearch('./your-project', 'vector database operations', 5);
results.forEach(result => {
    console.log(`File: ${result.relativePath}`);
    console.log(`Score: ${(result.score * 100).toFixed(2)}%`);
    console.log(`Content: ${result.content.substring(0, 100)}...`);
});
```

## 📦 Packages
> 📖 Each package has its own detailed documentation and usage examples. Click the links below to learn more.

### [@code-indexer/core](packages/core/README.md)
Core indexing engine that provides the fundamental functionality for code indexing and semantic search. Handles embedding generation, vector storage, and search operations.

### [@code-indexer/mcp](packages/mcp/README.md) 
Model Context Protocol (MCP) server that enables AI assistants and agents to interact with CodeIndexer through a standardized protocol. Exposes indexing and search capabilities via MCP tools.
![img](https://lh7-rt.googleusercontent.com/slidesz/AGV_vUfOR-7goqarF653roYT5u_HY_J3VkMMeUPUc2ZVj11ue82_tIzE_lIOuJ27HWcVYjTEQj2S3v9tZtS0-AXpyOP6F9VV_mymssD-57wT_ZVjF2MrS7cm5Ynj0goSEPpy81N4xSqi=s2048?key=DDtZSt7cnK5OdJgxQI2Ysg)

### [VSCode Extension](packages/vscode-extension/README.md)
Visual Studio Code extension that integrates CodeIndexer directly into your IDE. Provides an intuitive interface for semantic code search and navigation.
![img](https://lh7-rt.googleusercontent.com/slidesz/AGV_vUeRa3Luaxqwi1yk3AtAO2IJNQr-nF8ZwRjPz6YSrqw8LgFFMh_ry3IHdTuINOIMMbSAQo-eq3ffgpfS0hFInfa-k9Uwgw1YlRyMqc1ean2KFyyyqCv3lenFZIpCB3dsBuGMp40MUQ=s2048?key=DDtZSt7cnK5OdJgxQI2Ysg)


## 🛠️ Development

### Setup Development Environment

```bash
# Clone repository
git clone https://github.com/zilliztech/CodeIndexer.git
cd CodeIndexer

# Install dependencies
pnpm install

# Start development mode
pnpm dev
```

### Building

```bash
# Build all packages
pnpm build

# Build specific package
pnpm build:core
pnpm build:vscode
pnpm build:mcp
```

### Running Examples

```bash
# Basic usage example
pnpm example:basic

# Development with file watching
cd examples/basic-usage
pnpm dev
```

## 🔧 Configuration

### Environment Variables

```bash
# Required: Embedding provider API key
OPENAI_API_KEY=your-openai-api-key
# or
VOYAGEAI_API_KEY=your-voyageai-api-key

# Optional: Milvus configuration
MILVUS_ADDRESS=localhost:19530
MILVUS_TOKEN=your-milvus-token
```

### Supported File Extensions

By default, CodeIndexer supports:
- Programming languages: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.java`, `.cpp`, `.c`, `.h`, `.hpp`, `.cs`, `.go`, `.rs`, `.php`, `.rb`, `.swift`, `.kt`, `.scala`, `.m`, `.mm`
- Documentation: `.md`, `.markdown`

### Ignore Patterns

Common directories and files are automatically ignored:
- `node_modules/**`, `dist/**`, `build/**`
- `.git/**`, `.vscode/**`, `.idea/**`
- `*.log`, `*.min.js`, `*.map`

## 📖 Examples

Check the `/examples` directory for complete usage examples:

- **Basic Usage**: Simple indexing and search example

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to get started.

**Package-specific contributing guides:**
- [Core Package Contributing](packages/core/CONTRIBUTING.md)
- [MCP Server Contributing](packages/mcp/CONTRIBUTING.md)  
- [VSCode Extension Contributing](packages/vscode-extension/CONTRIBUTING.md)


## 🗺️ Roadmap

- [ ] AST-based code analysis for improved understanding
- [ ] Support for additional embedding providers
- [ ] Agent-based interactive search mode
- [ ] Enhanced code chunking strategies
- [ ] Search result ranking optimization

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [GitHub Repository](https://github.com/zilliztech/CodeIndexer)
- [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)
- [Milvus Documentation](https://milvus.io/docs)
- [Zilliz Cloud](https://zilliz.com/cloud)