# Claude Context Examples

This directory contains usage examples for Claude Context.

## Available Examples

### [basic-usage](./basic-usage/)
General example demonstrating both Milvus and Qdrant vector database configurations. Shows how to:
- Index a codebase with semantic search capabilities
- Perform natural language queries on code
- Switch between Milvus and Qdrant databases using environment variables
- Handle different embedding providers (OpenAI, VoyageAI, Gemini, Ollama)

### [qdrant-usage](./qdrant-usage/)
Qdrant-specific example showcasing the benefits of using Qdrant as a vector database. Includes:
- Simple single-container deployment setup
- Fast search performance optimization
- Advanced metadata filtering examples
- Comparison with Milvus features
- Production deployment configurations
- Troubleshooting and performance tips

## Quick Start

Each example contains its own README with detailed setup instructions. Generally:

1. Install dependencies:
   ```bash
   cd examples/[example-name]
   npm install
   ```

2. Set up environment variables (see individual README files)

3. Run the example:
   ```bash
   npm start
   ```
