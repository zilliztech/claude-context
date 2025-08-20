import { MilvusClient, DataType, MetricType, FunctionType, LoadState, IndexState } from '@zilliz/milvus2-sdk-node';
import {
    VectorDocument,
    SearchOptions,
    VectorSearchResult,
    VectorDatabase,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult,
    COLLECTION_LIMIT_MESSAGE
} from './types';
import { ClusterManager } from './zilliz-utils';

export interface MilvusConfig {
    address?: string;
    token?: string;
    username?: string;
    password?: string;
    ssl?: boolean;
}

/**
 * Wrapper function to handle collection creation with limit detection for gRPC client
 * This is the single point where collection limit errors are detected and handled
 */
async function createCollectionWithLimitCheck(
    client: MilvusClient,
    createCollectionParams: any
): Promise<void> {
    try {
        await client.createCollection(createCollectionParams);
    } catch (error: any) {
        // Check if the error message contains the collection limit exceeded pattern
        const errorMessage = error.message || error.toString() || '';
        if (/exceeded the limit number of collections/i.test(errorMessage)) {
            // Throw the exact message string, not an Error object
            throw COLLECTION_LIMIT_MESSAGE;
        }
        // Re-throw other errors as-is
        throw error;
    }
}

export class MilvusVectorDatabase implements VectorDatabase {
    protected config: MilvusConfig;
    private client: MilvusClient | null = null;
    protected initializationPromise: Promise<void>;

    constructor(config: MilvusConfig) {
        this.config = config;

        // Start initialization asynchronously without waiting
        this.initializationPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        const resolvedAddress = await this.resolveAddress();
        await this.initializeClient(resolvedAddress);
    }

    private async initializeClient(address: string): Promise<void> {
        const milvusConfig = this.config as MilvusConfig;
        console.log('🔌 Connecting to vector database at: ', address);
        this.client = new MilvusClient({
            address: address,
            username: milvusConfig.username,
            password: milvusConfig.password,
            token: milvusConfig.token,
            ssl: milvusConfig.ssl || false,
        });
    }

    /**
     * Resolve address from config or token
     * Common logic for both gRPC and REST implementations
     */
    protected async resolveAddress(): Promise<string> {
        let finalConfig = { ...this.config };

        // If address is not provided, get it using token
        if (!finalConfig.address && finalConfig.token) {
            finalConfig.address = await ClusterManager.getAddressFromToken(finalConfig.token);
        }

        if (!finalConfig.address) {
            throw new Error('Address is required and could not be resolved from token');
        }

        return finalConfig.address;
    }

    /**
     * Ensure initialization is complete before method execution
     */
    protected async ensureInitialized(): Promise<void> {
        await this.initializationPromise;
        if (!this.client) {
            throw new Error('Client not initialized');
        }
    }

    /**
     * Ensure collection is loaded before search/query operations
     */
    protected async ensureLoaded(collectionName: string): Promise<void> {
        if (!this.client) {
            throw new Error('MilvusClient is not initialized. Call ensureInitialized() first.');
        }

        try {
            // Check if collection is loaded
            const result = await this.client.getLoadState({
                collection_name: collectionName
            });

            if (result.state !== LoadState.LoadStateLoaded) {
                console.log(`🔄 Loading collection '${collectionName}' to memory...`);
                await this.client.loadCollection({
                    collection_name: collectionName,
                });
            }
        } catch (error) {
            console.error(`❌ Failed to ensure collection '${collectionName}' is loaded:`, error);
            throw error;
        }
    }

    /**
     * Wait for an index to be ready before proceeding
     * Polls index status with exponential backoff up to 30 seconds
     */
    protected async waitForIndexReady(collectionName: string, fieldName: string): Promise<void> {
        if (!this.client) {
            throw new Error('MilvusClient is not initialized. Call ensureInitialized() first.');
        }

        const maxWaitTime = 60000; // 60 seconds
        const initialInterval = 500; // 500ms
        const maxInterval = 5000; // 5 seconds
        const backoffMultiplier = 1.5;
        
        let interval = initialInterval;
        const startTime = Date.now();
        
        console.log(`⏳ Waiting for index on field '${fieldName}' in collection '${collectionName}' to be ready...`);
        
        while (Date.now() - startTime < maxWaitTime) {
            try {
                const indexStateResult = await this.client.getIndexState({
                    collection_name: collectionName,
                    field_name: fieldName
                });
                
                // Debug logging to understand the state value
                console.log(`📊 Index state for '${fieldName}': raw=${indexStateResult.state}, type=${typeof indexStateResult.state}, IndexState.Finished=${IndexState.Finished}`);
                console.log(`📊 Full response:`, JSON.stringify(indexStateResult));
                
                // Check both numeric and potential string values
                // Cast to any to bypass TypeScript checks while debugging
                const stateValue = indexStateResult.state as any;
                if (stateValue === IndexState.Finished || 
                    stateValue === 3 || 
                    stateValue === 'Finished') {
                    console.log(`✅ Index on field '${fieldName}' is ready!`);
                    return;
                }
                
                if (indexStateResult.state === IndexState.Failed) {
                    throw new Error(`Index creation failed for field '${fieldName}' in collection '${collectionName}'`);
                }
                
                // Wait with exponential backoff
                await new Promise(resolve => setTimeout(resolve, interval));
                interval = Math.min(interval * backoffMultiplier, maxInterval);
                
            } catch (error) {
                console.error(`❌ Error checking index state for field '${fieldName}':`, error);
                throw error;
            }
        }
        
        throw new Error(`Timeout waiting for index on field '${fieldName}' in collection '${collectionName}' to be ready after ${maxWaitTime}ms`);
    }

    /**
     * Load collection with retry logic and exponential backoff
     * Retries up to 5 times with exponential backoff
     */
    protected async loadCollectionWithRetry(collectionName: string): Promise<void> {
        if (!this.client) {
            throw new Error('MilvusClient is not initialized. Call ensureInitialized() first.');
        }

        const maxRetries = 5;
        const initialInterval = 1000; // 1 second
        const backoffMultiplier = 2;
        
        let attempt = 1;
        let interval = initialInterval;
        
        while (attempt <= maxRetries) {
            try {
                console.log(`🔄 Loading collection '${collectionName}' to memory (attempt ${attempt}/${maxRetries})...`);
                
                await this.client.loadCollection({
                    collection_name: collectionName,
                });
                
                console.log(`✅ Collection '${collectionName}' loaded successfully!`);
                return;
                
            } catch (error) {
                console.error(`❌ Failed to load collection '${collectionName}' on attempt ${attempt}:`, error);
                
                if (attempt === maxRetries) {
                    throw new Error(`Failed to load collection '${collectionName}' after ${maxRetries} attempts: ${error}`);
                }
                
                // Wait with exponential backoff before retry
                console.log(`⏳ Retrying collection load in ${interval}ms...`);
                await new Promise(resolve => setTimeout(resolve, interval));
                interval *= backoffMultiplier;
                attempt++;
            }
        }
    }

    async createCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();

        console.log('Beginning collection creation:', collectionName);
        console.log('Collection dimension:', dimension);
        const schema = [
            {
                name: 'id',
                description: 'Document ID',
                data_type: DataType.VarChar,
                max_length: 512,
                is_primary_key: true,
            },
            {
                name: 'vector',
                description: 'Embedding vector',
                data_type: DataType.FloatVector,
                dim: dimension,
            },
            {
                name: 'content',
                description: 'Document content',
                data_type: DataType.VarChar,
                max_length: 65535,
            },
            {
                name: 'relativePath',
                description: 'Relative path to the codebase',
                data_type: DataType.VarChar,
                max_length: 1024,
            },
            {
                name: 'startLine',
                description: 'Start line number of the chunk',
                data_type: DataType.Int64,
            },
            {
                name: 'endLine',
                description: 'End line number of the chunk',
                data_type: DataType.Int64,
            },
            {
                name: 'fileExtension',
                description: 'File extension',
                data_type: DataType.VarChar,
                max_length: 32,
            },
            {
                name: 'metadata',
                description: 'Additional document metadata as JSON string',
                data_type: DataType.VarChar,
                max_length: 65535,
            },
        ];

        const createCollectionParams = {
            collection_name: collectionName,
            description: description || `Claude Context collection: ${collectionName}`,
            fields: schema,
        };

        if (!this.client) {
            throw new Error('MilvusClient is not initialized. Call ensureInitialized() first.');
        }

        await createCollectionWithLimitCheck(this.client, createCollectionParams);

        // Create index
        const indexParams = {
            collection_name: collectionName,
            field_name: 'vector',
            index_type: 'AUTOINDEX',
            metric_type: MetricType.COSINE,
        };

        console.log(`🔧 Creating index for field 'vector' in collection '${collectionName}'...`);
        await this.client.createIndex(indexParams);

        // Wait for index to be ready before loading collection
        await this.waitForIndexReady(collectionName, 'vector');

        // Load collection to memory with retry logic
        await this.loadCollectionWithRetry(collectionName);

        // Verify collection is created correctly
        await this.client.describeCollection({
            collection_name: collectionName,
        });
    }

    async dropCollection(collectionName: string): Promise<void> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        await this.client.dropCollection({
            collection_name: collectionName,
        });
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        const result = await this.client.hasCollection({
            collection_name: collectionName,
        });

        return Boolean(result.value);
    }

    async listCollections(): Promise<string[]> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        const result = await this.client.showCollections();
        // Handle the response format - cast to any to avoid type errors
        const collections = (result as any).collection_names || (result as any).collections || [];
        return Array.isArray(collections) ? collections : [];
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        console.log('Inserting documents into collection:', collectionName);
        const data = documents.map(doc => ({
            id: doc.id,
            vector: doc.vector,
            content: doc.content,
            relativePath: doc.relativePath,
            startLine: doc.startLine,
            endLine: doc.endLine,
            fileExtension: doc.fileExtension,
            metadata: JSON.stringify(doc.metadata),
        }));

        await this.client.insert({
            collection_name: collectionName,
            data: data,
        });
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        const searchParams: any = {
            collection_name: collectionName,
            data: [queryVector],
            limit: options?.topK || 10,
            output_fields: ['id', 'content', 'relativePath', 'startLine', 'endLine', 'fileExtension', 'metadata'],
        };

        // Apply boolean expression filter if provided (e.g., fileExtension in [".ts",".py"]) 
        if (options?.filterExpr && options.filterExpr.trim().length > 0) {
            searchParams.expr = options.filterExpr;
        }

        const searchResult = await this.client.search(searchParams);

        if (!searchResult.results || searchResult.results.length === 0) {
            return [];
        }

        return searchResult.results.map((result: any) => ({
            document: {
                id: result.id,
                vector: queryVector,
                content: result.content,
                relativePath: result.relativePath,
                startLine: result.startLine,
                endLine: result.endLine,
                fileExtension: result.fileExtension,
                metadata: JSON.parse(result.metadata || '{}'),
            },
            score: result.score,
        }));
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        await this.client.delete({
            collection_name: collectionName,
            filter: `id in [${ids.map(id => `"${id}"`).join(', ')}]`,
        });
    }

    async query(collectionName: string, filter: string, outputFields: string[], limit?: number): Promise<Record<string, any>[]> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        try {
            const queryParams: any = {
                collection_name: collectionName,
                filter: filter,
                output_fields: outputFields,
            };

            // Add limit if provided, or default for empty filter expressions
            if (limit !== undefined) {
                queryParams.limit = limit;
            } else if (filter === '' || filter.trim() === '') {
                // Milvus requires limit when using empty expressions
                queryParams.limit = 16384; // Default limit for empty filters
            }

            const result = await this.client.query(queryParams);

            if (result.status.error_code !== 'Success') {
                throw new Error(`Failed to query Milvus: ${result.status.reason}`);
            }

            return result.data || [];
        } catch (error) {
            console.error(`❌ Failed to query collection '${collectionName}':`, error);
            throw error;
        }
    }

    async createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();

        console.log('Beginning hybrid collection creation:', collectionName);
        console.log('Collection dimension:', dimension);

        const schema = [
            {
                name: 'id',
                description: 'Document ID',
                data_type: DataType.VarChar,
                max_length: 512,
                is_primary_key: true,
            },
            {
                name: 'content',
                description: 'Full text content for BM25 and storage',
                data_type: DataType.VarChar,
                max_length: 65535,
                enable_analyzer: true,
            },
            {
                name: 'vector',
                description: 'Dense vector embedding',
                data_type: DataType.FloatVector,
                dim: dimension,
            },
            {
                name: 'sparse_vector',
                description: 'Sparse vector embedding from BM25',
                data_type: DataType.SparseFloatVector,
            },
            {
                name: 'relativePath',
                description: 'Relative path to the codebase',
                data_type: DataType.VarChar,
                max_length: 1024,
            },
            {
                name: 'startLine',
                description: 'Start line number of the chunk',
                data_type: DataType.Int64,
            },
            {
                name: 'endLine',
                description: 'End line number of the chunk',
                data_type: DataType.Int64,
            },
            {
                name: 'fileExtension',
                description: 'File extension',
                data_type: DataType.VarChar,
                max_length: 32,
            },
            {
                name: 'metadata',
                description: 'Additional document metadata as JSON string',
                data_type: DataType.VarChar,
                max_length: 65535,
            },
        ];

        // Add BM25 function
        const functions = [
            {
                name: "content_bm25_emb",
                description: "content bm25 function",
                type: FunctionType.BM25,
                input_field_names: ["content"],
                output_field_names: ["sparse_vector"],
                params: {},
            },
        ];

        const createCollectionParams = {
            collection_name: collectionName,
            description: description || `Hybrid code context collection: ${collectionName}`,
            fields: schema,
            functions: functions,
        };

        if (!this.client) {
            throw new Error('MilvusClient is not initialized. Call ensureInitialized() first.');
        }

        await createCollectionWithLimitCheck(this.client, createCollectionParams);

        // Create indexes for both vector fields
        // Index for dense vector
        const denseIndexParams = {
            collection_name: collectionName,
            field_name: 'vector',
            index_type: 'AUTOINDEX',
            metric_type: MetricType.COSINE,
        };
        console.log(`🔧 Creating dense vector index for field 'vector' in collection '${collectionName}'...`);
        await this.client.createIndex(denseIndexParams);

        // Wait for dense vector index to be ready
        await this.waitForIndexReady(collectionName, 'vector');

        // Index for sparse vector
        const sparseIndexParams = {
            collection_name: collectionName,
            field_name: 'sparse_vector',
            index_type: 'SPARSE_INVERTED_INDEX',
            metric_type: MetricType.BM25,
        };
        console.log(`🔧 Creating sparse vector index for field 'sparse_vector' in collection '${collectionName}'...`);
        await this.client.createIndex(sparseIndexParams);

        // Wait for sparse vector index to be ready
        await this.waitForIndexReady(collectionName, 'sparse_vector');

        // Load collection to memory with retry logic
        await this.loadCollectionWithRetry(collectionName);

        // Verify collection is created correctly
        await this.client.describeCollection({
            collection_name: collectionName,
        });
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        const data = documents.map(doc => ({
            id: doc.id,
            content: doc.content,
            vector: doc.vector,
            relativePath: doc.relativePath,
            startLine: doc.startLine,
            endLine: doc.endLine,
            fileExtension: doc.fileExtension,
            metadata: JSON.stringify(doc.metadata),
        }));

        await this.client.insert({
            collection_name: collectionName,
            data: data,
        });
    }

    async hybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options?: HybridSearchOptions): Promise<HybridSearchResult[]> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        try {
            // Generate OpenAI embedding for the first search request (dense)
            console.log(`🔍 Preparing hybrid search for collection: ${collectionName}`);

            // Prepare search requests in the correct Milvus format
            const search_param_1 = {
                data: Array.isArray(searchRequests[0].data) ? searchRequests[0].data : [searchRequests[0].data],
                anns_field: searchRequests[0].anns_field, // "vector"
                param: searchRequests[0].param, // {"nprobe": 10}
                limit: searchRequests[0].limit
            };

            const search_param_2 = {
                data: searchRequests[1].data, // query text for sparse search
                anns_field: searchRequests[1].anns_field, // "sparse_vector"
                param: searchRequests[1].param, // {"drop_ratio_search": 0.2}
                limit: searchRequests[1].limit
            };

            // Set rerank strategy to RRF (100) by default
            const rerank_strategy = {
                strategy: "rrf",
                params: {
                    k: 100
                }
            };

            console.log(`🔍 Dense search params:`, JSON.stringify({
                anns_field: search_param_1.anns_field,
                param: search_param_1.param,
                limit: search_param_1.limit,
                data_length: Array.isArray(search_param_1.data[0]) ? search_param_1.data[0].length : 'N/A'
            }, null, 2));
            console.log(`🔍 Sparse search params:`, JSON.stringify({
                anns_field: search_param_2.anns_field,
                param: search_param_2.param,
                limit: search_param_2.limit,
                query_text: typeof search_param_2.data === 'string' ? search_param_2.data.substring(0, 50) + '...' : 'N/A'
            }, null, 2));
            console.log(`🔍 Rerank strategy:`, JSON.stringify(rerank_strategy, null, 2));

            // Execute hybrid search using the correct client.search format
            const searchParams: any = {
                collection_name: collectionName,
                data: [search_param_1, search_param_2],
                limit: options?.limit || searchRequests[0]?.limit || 10,
                rerank: rerank_strategy,
                output_fields: ['id', 'content', 'relativePath', 'startLine', 'endLine', 'fileExtension', 'metadata'],
            };

            if (options?.filterExpr && options.filterExpr.trim().length > 0) {
                searchParams.expr = options.filterExpr;
            }

            console.log(`🔍 Complete search request:`, JSON.stringify({
                collection_name: searchParams.collection_name,
                data_count: searchParams.data.length,
                limit: searchParams.limit,
                rerank: searchParams.rerank,
                output_fields: searchParams.output_fields,
                expr: searchParams.expr
            }, null, 2));

            const searchResult = await this.client.search(searchParams);

            console.log(`🔍 Search executed, processing results...`);

            if (!searchResult.results || searchResult.results.length === 0) {
                console.log(`⚠️  No results returned from Milvus search`);
                return [];
            }

            console.log(`✅ Found ${searchResult.results.length} results from hybrid search`);

            // Transform results to HybridSearchResult format
            return searchResult.results.map((result: any) => ({
                document: {
                    id: result.id,
                    content: result.content,
                    vector: [],
                    sparse_vector: [],
                    relativePath: result.relativePath,
                    startLine: result.startLine,
                    endLine: result.endLine,
                    fileExtension: result.fileExtension,
                    metadata: JSON.parse(result.metadata || '{}'),
                },
                score: result.score,
            }));

        } catch (error) {
            console.error(`❌ Failed to perform hybrid search on collection '${collectionName}':`, error);
            throw error;
        }
    }
}