# Qdrant Usage Example

This example demonstrates how to use Claude Context with Qdrant vector database for semantic code search.

## Features

- **Simple Setup**: Single Docker container deployment
- **Fast Performance**: 10-30ms search latency
- **Advanced Filtering**: Rich metadata-based filtering
- **Real-time Updates**: No collection reloading needed
- **Self-contained**: No external dependencies like MinIO

## Prerequisites

1. **Qdrant Server**: Running Qdrant instance
2. **OpenAI API Key**: For embedding generation

## Quick Start

### 1. Start Qdrant

Using Docker (recommended):
```bash
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant:latest
```

Using docker-compose:
```yaml
version: '3.8'
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - ./qdrant_storage:/qdrant/storage
```

### 2. Set Environment Variables

```bash
export OPENAI_API_KEY="your-openai-api-key"
export QDRANT_URL="http://localhost:6333"  # Optional: defaults to localhost
export QDRANT_API_KEY="your-api-key"       # Optional: for Qdrant Cloud
```

### 3. Run the Example

```bash
npm install
npm start
```

## Configuration Options

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key (required) | - |
| `OPENAI_BASE_URL` | Custom OpenAI endpoint | - |
| `QDRANT_URL` | Qdrant server URL | `http://localhost:6333` |
| `QDRANT_API_KEY` | Qdrant API key | - |

## Qdrant vs Milvus Comparison

| Feature | Qdrant | Milvus |
|---------|--------|--------|
| **Deployment** | Single container | Multi-service (etcd, MinIO, etc.) |
| **Latency** | 10-30ms | 50ms+ |
| **Setup Complexity** | Low | High |
| **Filtering** | Advanced metadata filtering | Basic filtering |
| **Scale** | Good (< 10M vectors) | Excellent (billions) |
| **Dependencies** | Self-contained | Requires object storage |

## Using with Different Embedding Providers

### OpenAI
```typescript
const embedding = new OpenAIEmbedding({
    apiKey: 'your-api-key',
    model: 'text-embedding-3-small'
});
```

### Voyage AI
```typescript
const embedding = new VoyageAIEmbedding({
    apiKey: 'your-voyage-api-key',
    model: 'voyage-code-2'
});
```

### Ollama (Local)
```typescript
const embedding = new OllamaEmbedding({
    model: 'nomic-embed-text',
    host: 'http://localhost:11434'
});
```

## Production Deployment

### Qdrant Cloud
```typescript
const vectorDatabase = new QdrantVectorDatabase({
    url: 'https://your-cluster.qdrant.io',
    apiKey: 'your-api-key'
});
```

### Self-hosted with Persistence
```yaml
version: '3.8'
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - ./qdrant_storage:/qdrant/storage:Z
    environment:
      - QDRANT__SERVICE__HTTP_PORT=6333
      - QDRANT__SERVICE__GRPC_PORT=6334
```

## Performance Tips

1. **Collection Configuration**: Adjust shard_number based on your data size
2. **Batch Operations**: Use batch upserts for better performance
3. **Filtering**: Use payload indexes for frequently filtered fields
4. **Memory**: Configure quantization for memory optimization

## Troubleshooting

### Connection Issues
- Ensure Qdrant is running on the correct port (6333)
- Check firewall settings
- Verify QDRANT_URL format includes protocol (`http://`)

### Performance Issues
- Monitor Qdrant dashboard at `http://localhost:6333/dashboard`
- Check collection configuration
- Consider using payload indexes for filtering

### Memory Issues
- Enable quantization in collection config
- Adjust vector dimension if possible
- Use disk storage for large datasets

## Next Steps

- Explore [Qdrant documentation](https://qdrant.tech/documentation/)
- Try [Qdrant Cloud](https://cloud.qdrant.io/) for managed deployment
- Implement custom filtering logic
- Set up monitoring and logging