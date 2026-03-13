# Azure AI Search Vector Database Implementation

A comprehensive TypeScript implementation of the `VectorDatabase` interface using Azure AI Search (formerly Azure Cognitive Search) with support for vector search, hybrid search, and full-text search capabilities.

## 🌟 Features

- **Full VectorDatabase Interface Compliance**: Implements all methods defined in the `VectorDatabase` interface
- **Vector Search**: High-performance similarity search using HNSW (Hierarchical Navigable Small World) algorithm
- **Hybrid Search**: Combines dense vector search with full-text search for improved results
- **Semantic Search**: Leverages Azure's built-in semantic ranking capabilities
- **Batch Operations**: Efficient batch insertion with configurable batch sizes
- **Filtering**: Support for complex OData filter expressions
- **Auto-retry**: Built-in retry logic for failed operations
- **Collection Management**: Create, list, check, and drop indexes (collections)

## 📋 Prerequisites

- Azure subscription with Azure AI Search service
- Node.js 16+ and TypeScript
- Azure AI Search API key and endpoint

## 🚀 Installation

```bash
npm install @azure/search-documents
```

## 🔧 Configuration

```typescript
import { AzureAISearchVectorDatabase, AzureAISearchConfig } from './azure-ai-search-vectordb';

const config: AzureAISearchConfig = {
    endpoint: 'https://your-search-service.search.windows.net',
    apiKey: 'your-api-key',
    batchSize: 100,        // Optional: documents per batch (default: 100)
    maxRetries: 3,         // Optional: max retry attempts (default: 3)
    retryDelayMs: 1000,    // Optional: delay between retries (default: 1000ms)
};

const vectorDb = new AzureAISearchVectorDatabase(config);
```

## 📚 Usage Examples

### Creating a Collection

```typescript
// Create a standard vector collection
await vectorDb.createCollection(
    'code-embeddings',
    1536,  // Vector dimension (e.g., OpenAI ada-002)
    'Code embeddings for similarity search'
);

// Create a hybrid collection (supports both vector and text search)
await vectorDb.createHybridCollection(
    'code-hybrid',
    1536,
    'Hybrid search collection'
);
```

### Inserting Documents

```typescript
import { VectorDocument } from './types';

const documents: VectorDocument[] = [
    {
        id: 'doc1',
        vector: [0.1, 0.2, 0.3, ...], // 1536-dimensional vector
        content: 'function calculateTotal(items) { return items.reduce((sum, item) => sum + item.price, 0); }',
        relativePath: 'src/utils/calculator.js',
        startLine: 10,
        endLine: 12,
        fileExtension: 'js',
        metadata: {
            author: 'john.doe',
            lastModified: '2024-01-15',
            complexity: 'low'
        }
    },
    // ... more documents
];

// Insert documents
await vectorDb.insert('code-embeddings', documents);

// Insert with hybrid support
await vectorDb.insertHybrid('code-hybrid', documents);
```

### Vector Search

```typescript
import { SearchOptions } from './types';

// Generate query vector (e.g., using OpenAI embeddings)
const queryVector = [0.15, 0.25, 0.35, ...]; // 1536 dimensions

const options: SearchOptions = {
    topK: 10,
    threshold: 0.7,  // Minimum similarity score
    filterExpr: "fileExtension eq 'js' and startLine ge 1"  // OData filter
};

const results = await vectorDb.search('code-embeddings', queryVector, options);

results.forEach(result => {
    console.log(`Score: ${result.score}`);
    console.log(`File: ${result.document.relativePath}`);
    console.log(`Content: ${result.document.content}`);
    console.log(`Lines: ${result.document.startLine}-${result.document.endLine}`);
});
```

### Hybrid Search

```typescript
import { HybridSearchRequest, HybridSearchOptions } from './types';

// Prepare search requests
const searchRequests: HybridSearchRequest[] = [
    {
        data: queryVector,           // Dense vector
        anns_field: 'vector',
        param: { metric_type: 'COSINE' },
        limit: 20
    },
    {
        data: 'error handling async',  // Text query
        anns_field: 'sparse_vector',
        param: {},
        limit: 20
    }
];

const options: HybridSearchOptions = {
    rerank: {
        strategy: 'weighted',
        params: { 
            weights: [0.7, 0.3]  // 70% vector, 30% text
        }
    },
    limit: 10,
    filterExpr: "fileExtension eq 'ts'"
};

const results = await vectorDb.hybridSearch('code-hybrid', searchRequests, options);
```

### Filtering and Queries

```typescript
// Query with filter
const queryResults = await vectorDb.query(
    'code-embeddings',
    "startLine ge 50 and endLine le 100 and fileExtension eq 'py'",
    ['id', 'content', 'relativePath', 'startLine', 'endLine'],
    50  // limit
);

queryResults.forEach(doc => {
    console.log(`${doc.id}: ${doc.relativePath} (lines ${doc.startLine}-${doc.endLine})`);
});
```

### Deleting Documents

```typescript
// Delete specific documents by ID
await vectorDb.delete('code-embeddings', ['doc1', 'doc2', 'doc3']);
```

### Collection Management

```typescript
// List all collections (indexes)
const collections = await vectorDb.listCollections();
console.log('Available collections:', collections);

// Check if collection exists
const exists = await vectorDb.hasCollection('code-embeddings');
console.log('Collection exists:', exists);

// Get collection statistics
const stats = await vectorDb.getCollectionStats('code-embeddings');
console.log('Document count:', stats.entityCount);

// Check if you can create more collections
const canCreate = await vectorDb.checkCollectionLimit();
if (!canCreate) {
    console.log('Collection limit reached!');
}

// Drop a collection
await vectorDb.dropCollection('old-collection');
```

## 🔍 OData Filter Expressions

Azure AI Search uses OData filter syntax. Here are common patterns:

```typescript
// Equality
"fileExtension eq 'js'"

// Comparison
"startLine ge 10 and endLine le 100"

// String functions
"search.in(fileExtension, 'js,ts,py', ',')"
"startswith(relativePath, 'src/components')"

// Logical operators
"(fileExtension eq 'js' or fileExtension eq 'ts') and startLine gt 50"

// Date filters
"createdAt ge 2024-01-01T00:00:00Z"

// Combining filters
"fileExtension eq 'py' and startLine ge 1 and search.in(relativePath, 'src,lib', ',')"
```

## 🏗️ Architecture

### Index Schema

Each collection (index) in Azure AI Search has the following schema:

| Field | Type | Features |
|-------|------|----------|
| `id` | String | Key, Filterable |
| `vector` | Collection(Single) | Vector search enabled |
| `content` | String | Searchable, Full-text indexed |
| `relativePath` | String | Filterable, Sortable, Facetable |
| `startLine` | Int32 | Filterable, Sortable |
| `endLine` | Int32 | Filterable, Sortable |
| `fileExtension` | String | Filterable, Facetable |
| `metadata` | String | JSON storage |
| `createdAt` | DateTimeOffset | Filterable, Sortable |

### Vector Search Configuration

- **Algorithm**: HNSW (Hierarchical Navigable Small World)
- **Parameters**:
  - `m`: 4 (number of bi-directional links)
  - `efConstruction`: 400 (size of dynamic candidate list during index construction)
  - `efSearch`: 500 (size of dynamic candidate list during search)
  - `metric`: Cosine similarity

### Naming Conventions

Collection names are automatically normalized to meet Azure AI Search requirements:
- Converted to lowercase
- Non-alphanumeric characters replaced with hyphens
- Consecutive hyphens collapsed
- Leading/trailing hyphens removed
- Maximum length: 128 characters

## 🚨 Error Handling

```typescript
try {
    await vectorDb.createCollection('my-collection', 1536);
} catch (error) {
    if (error.message.includes('collection limit')) {
        // Handle quota exceeded
        console.error('Upgrade your Azure AI Search tier');
    } else if (error.statusCode === 404) {
        // Handle not found
        console.error('Resource not found');
    } else {
        // Handle other errors
        console.error('Operation failed:', error);
    }
}
```

## 📊 Performance Considerations

### Batch Size
- Default: 100 documents per batch
- Recommendation: 100-1000 for optimal throughput
- Larger batches = fewer requests but higher memory usage

### Index Size
- Free tier: Up to 50 indexes, 50 MB storage
- Basic tier: Up to 15 indexes, 2 GB storage
- Standard tiers: More indexes and storage

### Query Performance
- Vector search: ~10-50ms for small indexes (<100k docs)
- Hybrid search: Slightly slower due to combining multiple searches
- Use filters to reduce search space

## 🔒 Security Best Practices

1. **API Key Management**
   - Use Azure Key Vault for storing API keys
   - Rotate keys regularly
   - Use read-only keys for search-only applications

2. **Network Security**
   - Enable IP filtering on Azure AI Search service
   - Use private endpoints for production
   - Implement Azure AD authentication for enhanced security

3. **Data Protection**
   - Enable encryption at rest (default in Azure)
   - Use SSL/TLS for all connections (default)
   - Implement field-level encryption for sensitive metadata

## 🧪 Testing

```typescript
import { AzureAISearchVectorDatabase } from './azure-ai-search-vectordb';

describe('Azure AI Search Vector Database', () => {
    let vectorDb: AzureAISearchVectorDatabase;
    
    beforeAll(() => {
        vectorDb = new AzureAISearchVectorDatabase({
            endpoint: process.env.AZURE_SEARCH_ENDPOINT!,
            apiKey: process.env.AZURE_SEARCH_API_KEY!,
        });
    });
    
    afterAll(async () => {
        await vectorDb.close();
    });
    
    test('should create and list collections', async () => {
        await vectorDb.createCollection('test-collection', 128);
        const collections = await vectorDb.listCollections();
        expect(collections).toContain('test-collection');
        await vectorDb.dropCollection('test-collection');
    });
    
    // ... more tests
});
```

## 📈 Monitoring and Observability

Azure AI Search provides built-in monitoring:

1. **Azure Portal Metrics**
   - Query latency
   - Indexing throughput
   - Storage usage
   - Query rate

2. **Diagnostic Logs**
   - Enable diagnostic logging
   - Send logs to Log Analytics
   - Create alerts for errors

3. **Application Insights**
   - Track custom metrics
   - Monitor application performance
   - Analyze search patterns

## 🔄 Migration Guide

### From PostgreSQL + pgvector

```typescript
// Old PostgreSQL code
const postgresDb = new PostgresVectorDatabase({ ... });
await postgresDb.createCollection('docs', 1536);

// New Azure AI Search code (drop-in replacement)
const azureDb = new AzureAISearchVectorDatabase({ ... });
await azureDb.createCollection('docs', 1536);
// All other methods remain the same!
```

### From Milvus

The interface is identical, making migration straightforward:

```typescript
// Simply change the constructor
const vectorDb = new AzureAISearchVectorDatabase(config);
// Everything else stays the same
```

## 🆚 Comparison with Other Implementations

| Feature | Azure AI Search | PostgreSQL | Milvus |
|---------|----------------|------------|---------|
| Setup Complexity | Low (managed) | Medium | Medium-High |
| Hybrid Search | Native | Manual | Native |
| Scalability | Excellent | Good | Excellent |
| Cost | Pay-as-you-go | Infrastructure | Infrastructure |
| Full-text Search | Built-in | Manual | Limited |
| Managed Service | Yes | No | Cloud only |

## 🐛 Troubleshooting

### Common Issues

**Issue**: "Index name is invalid"
- **Solution**: Index names must be lowercase, alphanumeric with hyphens only

**Issue**: "Quota exceeded"
- **Solution**: Upgrade Azure AI Search tier or delete unused indexes

**Issue**: "Vector dimension mismatch"
- **Solution**: Ensure all vectors have the same dimension as specified during collection creation

**Issue**: "OData filter syntax error"
- **Solution**: Verify filter expression follows OData v4 specification

## 📖 Additional Resources

- [Azure AI Search Documentation](https://learn.microsoft.com/en-us/azure/search/)
- [OData Filter Syntax](https://learn.microsoft.com/en-us/azure/search/search-query-odata-filter)
- [Vector Search in Azure AI Search](https://learn.microsoft.com/en-us/azure/search/vector-search-overview)
- [@azure/search-documents SDK](https://www.npmjs.com/package/@azure/search-documents)

## 📄 License

This implementation is provided as-is for integration with your vector database abstraction layer.

## 🤝 Contributing

Contributions are welcome! Please ensure:
- All VectorDatabase interface methods are implemented
- Error handling follows the established patterns
- Tests are included for new features
- Documentation is updated

---

**Note**: This implementation fully adheres to the `VectorDatabase` interface and can be used as a drop-in replacement for other implementations like PostgreSQL or Milvus.