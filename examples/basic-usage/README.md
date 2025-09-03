# Basic Usage Example

This example demonstrates the basic usage of Claude Context with support for both **Milvus** and **Qdrant** vector databases.

## Prerequisites

1. **OpenAI API Key**: Set your OpenAI API key for embeddings:
   ```bash
   export OPENAI_API_KEY="your-openai-api-key"
   ```

2. **Vector Database**: Choose and set up one of the supported vector databases:

### Option 1: Milvus (Default)

Make sure Milvus server is running:
- You can also use fully managed Milvus on [Zilliz Cloud](https://zilliz.com/cloud). 
    In this case, set the `MILVUS_ADDRESS` as the Public Endpoint and `MILVUS_TOKEN` as the Token like this:
    ```bash
    export MILVUS_ADDRESS="https://your-cluster.zillizcloud.com"
    export MILVUS_TOKEN="your-zilliz-token"
    ```


- You can also set up a Milvus server on [Docker or Kubernetes](https://milvus.io/docs/install-overview.md). In this setup, please use the server address and port as your `uri`, e.g.`http://localhost:19530`. If you enable the authentication feature on Milvus, set the `token` as `"<your_username>:<your_password>"`, otherwise there is no need to set the token.
    ```bash
    export MILVUS_ADDRESS="http://localhost:19530"
    export MILVUS_TOKEN="<your_username>:<your_password>"
    ```

### Option 2: Qdrant (Alternative)

For a simpler, single-container deployment, you can use Qdrant:

- **Local Qdrant with Docker** (recommended for development):
    ```bash
    # Start Qdrant server
    docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant:latest
    
    # Set environment variables
    export VECTOR_DB_TYPE="qdrant"
    export QDRANT_URL="http://localhost:6333"
    # QDRANT_API_KEY is optional for local development
    ```

- **Qdrant Cloud** (managed service):
    ```bash
    export VECTOR_DB_TYPE="qdrant"
    export QDRANT_URL="https://your-cluster.qdrant.io"
    export QDRANT_API_KEY="your-qdrant-api-key"
    ```

**Qdrant Advantages:**
- ✅ Simple single-container deployment
- ✅ Fast search performance (10-30ms)
- ✅ No external dependencies (no MinIO needed)
- ✅ Real-time updates without collection reloading


## Running the Example

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Set environment variables (see examples above)

3. Run the example:
   ```bash
   pnpm run start
   ```

## What This Example Does
1. **Detects Vector Database**: Automatically uses Milvus (default) or Qdrant based on `VECTOR_DB_TYPE` environment variable
2. **Indexes Codebase**: Indexes the entire Claude Context project using the selected vector database
3. **Performs Searches**: Executes semantic searches for different code patterns
4. **Shows Results**: Displays search results with similarity scores and file locations
5. **Demonstrates Performance**: Shows indexing stats and search performance for the selected database

## Expected Output

**With Milvus:**
```
🚀 Context Real Usage Example
===============================
🔧 Using Milvus gRPC implementation
🔌 Connecting to Milvus at: localhost:19530

📖 Starting to index codebase...
🗑️  Existing index found, clearing it first...
📊 Indexing stats: 45 files, 234 code chunks

🔍 Performing semantic search...

🔎 Search: "vector database operations"
   1. Similarity: 89.23%
      File: packages/core/src/vectordb/milvus-vectordb.ts
      Language: typescript
      Lines: 147-177
      Preview: async search(collectionName: string, queryVector: number[], options?: SearchOptions)...

🎉 Example completed successfully!
```

**With Qdrant:**
```
🚀 Context Real Usage Example
===============================
🔧 Using Qdrant vector database
🔌 Connecting to Qdrant at: http://localhost:6333

📖 Starting to index codebase...
🗑️  Existing index found, clearing it first...
📊 Indexing stats: 45 files, 234 code chunks

🔍 Performing semantic search...

🔎 Search: "Qdrant vector database implementation"
   1. Similarity: 92.15%
      File: packages/core/src/vectordb/qdrant-vectordb.ts
      Language: typescript
      Lines: 38-68
      Preview: async createCollection(collectionName: string, dimension: number, description?: string)...

🎉 Example completed successfully!
💡 Key advantages of Qdrant:
   ✅ Simple deployment (single Docker container)
   ✅ Fast search performance (10-30ms latency)
   ✅ No external dependencies (no MinIO needed)
```

## Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `OPENAI_API_KEY` | OpenAI API key for embeddings | - | Yes |
| `VECTOR_DB_TYPE` | Vector database type (`milvus` or `qdrant`) | `milvus` | No |
| **Milvus Settings** | | | |
| `MILVUS_ADDRESS` | Milvus server address | `localhost:19530` | No |
| `MILVUS_TOKEN` | Milvus authentication token | - | No |
| `MILVUS_USE_RESTFUL` | Use REST API instead of gRPC | `false` | No |
| **Qdrant Settings** | | | |
| `QDRANT_URL` | Qdrant server URL | `http://localhost:6333` | No |
| `QDRANT_API_KEY` | Qdrant API key | - | No |
| **Code Splitter Settings** | | | |
| `SPLITTER_TYPE` | Code splitter (`ast` or `langchain`) | `ast` | No |
