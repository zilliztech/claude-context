# Project Overview

## What is Code Context?

Code Context is a powerful semantic code search tool that gives AI coding assistants deep understanding of your entire codebase. Instead of traditional keyword-based search, Code Context uses vector embeddings and AI to understand the meaning and context of your code.

## Key Features

### 🔍 Semantic Code Search
Ask natural language questions like "find functions that handle user authentication" and get relevant code snippets from across your entire codebase.

### 🧠 Context-Aware Understanding
Discover relationships between different parts of your code, even across millions of lines. The system understands code structure, patterns, and dependencies.

### ⚡ Incremental Indexing
Efficiently re-index only changed files using Merkle trees, making it fast to keep your search index up-to-date.

### 🧩 Intelligent Code Chunking
Uses Abstract Syntax Trees (AST) to intelligently split code into meaningful chunks that preserve context and structure.

### 🗄️ Scalable Architecture
Integrates with Zilliz Cloud for scalable vector search, handling codebases of any size.

### 🛠️ Highly Customizable
Configure file extensions, ignore patterns, embedding models, and search parameters to fit your specific needs.

## How It Works

### 1. Code Analysis
Code Context analyzes your codebase using AST parsers to understand code structure and semantics.

### 2. Intelligent Chunking
Code is split into meaningful chunks that preserve context, function boundaries, and logical groupings.

### 3. Vector Embeddings
Each code chunk is converted into high-dimensional vectors using state-of-the-art embedding models.

### 4. Vector Storage
Embeddings are stored in a vector database (Milvus/Zilliz Cloud) for efficient similarity search.

### 5. Semantic Search
Natural language queries are converted to vectors and matched against stored code embeddings.

## Architecture Components

### Core Engine (`@zilliz/code-context-core`)
The foundational indexing engine that handles:
- Code parsing and analysis
- Embedding generation
- Vector database operations
- Search algorithms

### MCP Server (`@zilliz/code-context-mcp`)
Model Context Protocol server that enables integration with AI assistants:
- Standardized tool interface
- Compatible with Claude Code, Cursor, Windsurf, and more
- Real-time indexing and search capabilities

### VSCode Extension
Native Visual Studio Code integration:
- Semantic search sidebar
- Context-aware code navigation
- Progressive indexing with visual feedback

### Chrome Extension
GitHub integration for web-based development:
- Semantic search on GitHub repositories
- Context-aware code browsing
- Cross-repository search capabilities

## Supported Technologies

### Programming Languages
- **Compiled Languages**: TypeScript, JavaScript, Java, C++, C#, Go, Rust
- **Scripting Languages**: Python, PHP, Ruby
- **Mobile**: Swift, Kotlin, Scala, Objective-C
- **Documentation**: Markdown

### Embedding Providers
- **OpenAI**: `text-embedding-3-small`, `text-embedding-3-large`
- **VoyageAI**: `voyage-code-3`, specialized for code understanding
- **Gemini**: Google's embedding models with Matryoshka representation
- **Ollama**: Local embedding models for privacy-focused development

### Vector Databases
- **Milvus**: Open-source vector database
- **Zilliz Cloud**: Fully managed vector database service

### AI Assistant Integration
- **Claude Code**: Native MCP integration
- **Cursor**: MCP configuration support
- **Windsurf**: JSON-based MCP setup
- **VSCode**: Direct extension + MCP support
- **And more**: Any MCP-compatible AI assistant

## Use Cases

### Large Codebase Navigation
Quickly find relevant code patterns, implementations, and examples across massive codebases.

### Code Review Assistance
Identify similar code patterns, potential duplications, and related functionality during reviews.

### Learning and Onboarding
Help new team members understand codebase structure and find relevant examples.

### Refactoring Support
Locate all instances of specific patterns or implementations that need updating.

### API Discovery
Find usage examples and implementations of specific APIs or libraries.

### Cross-Language Development
Search for similar functionality across different programming languages in polyglot codebases.
