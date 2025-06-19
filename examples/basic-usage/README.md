# Basic Usage Example

This example demonstrates the basic usage of CodeIndexer.

## Prerequisites

1. **OpenAI API Key**: Set your OpenAI API key for embeddings:
   ```bash
   export OPENAI_API_KEY="your-openai-api-key"
   ```

2. **Milvus Server**: Make sure Milvus server is running:
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
1. **Indexes Codebase**: Indexes the entire CodeIndexer project
2. **Performs Searches**: Executes semantic searches for different code patterns
3. **Shows Results**: Displays search results with similarity scores and file locations

## Expected Output

```
🚀 CodeIndexer Real Usage Example
===============================
...
🔌 Connecting to vector database at: ...

📖 Starting to index codebase...
🗑️  Existing index found, clearing it first...
📊 Indexing stats: 45 files, 234 code chunks

🔍 Performing semantic search...

🔎 Search: "vector database operations"
   1. Similarity: 89.23%
      File: /path/to/packages/core/src/vectordb/milvus-vectordb.ts
      Language: typescript
      Lines: 147-177
      Preview: async search(collectionName: string, queryVector: number[], options?: SearchOptions)...

🎉 Example completed successfully!
```
