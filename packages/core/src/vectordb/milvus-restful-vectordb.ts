/**
 * Milvus RESTful Vector Database Implementation
 * 
 * This RESTful implementation of Milvus vector database is specifically designed for 
 * environments with strict dependency constraints, e.g. VSCode Extensions, Chrome Extensions, etc.
 * 
 * The standard Milvus gRPC implementation requires some dependencies and modules
 * that are not available or restricted in these constrained environments. This RESTful
 * implementation uses only HTTP requests, making it compatible with them.
 */

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

export interface MilvusRestfulConfig {
    address?: string;
    token?: string;
    username?: string;
    password?: string;
    database?: string;
}

/**
 * TODO: Change this usage to checkCollectionLimit()
 * Wrapper function to handle collection creation with limit detection
 * This is the single point where collection limit errors are detected and handled
 */
async function createCollectionWithLimitCheck(
    makeRequestFn: (endpoint: string, method: 'GET' | 'POST', data?: any) => Promise<any>,
    collectionSchema: any
): Promise<void> {
    try {
        await makeRequestFn('/collections/create', 'POST', collectionSchema);
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

/**
 * Milvus Vector Database implementation using REST API
 * This implementation is designed for environments where gRPC is not available,
 * such as VSCode extensions or browser environments.
 */
export class MilvusRestfulVectorDatabase implements VectorDatabase {
    protected config: MilvusRestfulConfig;
    private baseUrl: string | null = null;
    protected initializationPromise: Promise<void>;

    constructor(config: MilvusRestfulConfig) {
        this.config = config;

        // Start initialization asynchronously without waiting
        this.initializationPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        const resolvedAddress = await this.resolveAddress();
        await this.initializeClient(resolvedAddress);
    }

    private async initializeClient(address: string): Promise<void> {
        // Ensure address has protocol prefix
        let processedAddress = address;
        if (!processedAddress.startsWith('http://') && !processedAddress.startsWith('https://')) {
            processedAddress = `http://${processedAddress}`;
        }

        this.baseUrl = processedAddress.replace(/\/$/, '') + '/v2/vectordb';

        console.log(`🔌 Connecting to Milvus REST API at: ${processedAddress}`);
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
        if (!this.baseUrl) {
            throw new Error('Base URL not initialized');
        }
    }

    /**
     * Ensure collection is loaded before search/query operations
     */
    protected async ensureLoaded(collectionName: string): Promise<void> {
        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            // Check if collection is loaded
            const response = await this.makeRequest('/collections/get_load_state', 'POST', {
                collectionName,
                dbName: restfulConfig.database
            });

            const loadState = response.data?.loadState;
            if (loadState !== 'LoadStateLoaded') {
                console.log(`[MilvusRestfulDB] 🔄 Loading collection '${collectionName}' to memory...`);
                await this.loadCollection(collectionName);
            }
        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to ensure collection '${collectionName}' is loaded:`, error);
            throw error;
        }
    }

    /**
     * Make HTTP request to Milvus REST API
     */
    private async makeRequest(endpoint: string, method: 'GET' | 'POST' = 'POST', data?: any): Promise<any> {
        const url = `${this.baseUrl}${endpoint}`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        // Handle authentication
        if (this.config.token) {
            headers['Authorization'] = `Bearer ${this.config.token}`;
        } else if (this.config.username && this.config.password) {
            headers['Authorization'] = `Bearer ${this.config.username}:${this.config.password}`;
        }

        const requestOptions: RequestInit = {
            method,
            headers,
        };

        if (data && method === 'POST') {
            requestOptions.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, requestOptions);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result: any = await response.json();

            if (result.code !== 0 && result.code !== 200) {
                throw new Error(`Milvus API error: ${result.message || 'Unknown error'}`);
            }

            return result;
        } catch (error) {
            console.error(`[MilvusRestfulDB] Milvus REST API request failed:`, error);
            throw error;
        }
    }

    async createCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();

        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            // Build collection schema based on the original milvus-vectordb.ts implementation
            // Note: REST API doesn't support description parameter in collection creation
            // Unlike gRPC version, the description parameter is ignored in REST API
            const collectionSchema = {
                collectionName,
                dbName: restfulConfig.database,
                schema: {
                    enableDynamicField: false,
                    fields: [
                        {
                            fieldName: "id",
                            dataType: "VarChar",
                            isPrimary: true,
                            elementTypeParams: {
                                max_length: 512
                            }
                        },
                        {
                            fieldName: "vector",
                            dataType: "FloatVector",
                            elementTypeParams: {
                                dim: dimension
                            }
                        },
                        {
                            fieldName: "content",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 65535
                            }
                        },
                        {
                            fieldName: "relativePath",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 1024
                            }
                        },
                        {
                            fieldName: "startLine",
                            dataType: "Int64"
                        },
                        {
                            fieldName: "endLine",
                            dataType: "Int64"
                        },
                        {
                            fieldName: "fileExtension",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 32
                            }
                        },
                        {
                            fieldName: "metadata",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 65535
                            }
                        }
                    ]
                }
            };

            // Step 1: Create collection with schema
            await createCollectionWithLimitCheck(this.makeRequest.bind(this), collectionSchema);

            // Step 2: Create index for vector field (separate API call)
            await this.createIndex(collectionName);

            // Step 3: Load collection to memory for searching
            await this.loadCollection(collectionName);

        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to create collection '${collectionName}':`, error);
            throw error;
        }
    }

    /**
     * Create index for vector field using the Index Create API
     */
    private async createIndex(collectionName: string): Promise<void> {
        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            const indexParams = {
                collectionName,
                dbName: restfulConfig.database,
                indexParams: [
                    {
                        fieldName: "vector",
                        indexName: "vector_index",
                        metricType: "COSINE",
                        index_type: "AUTOINDEX"
                    }
                ]
            };

            await this.makeRequest('/indexes/create', 'POST', indexParams);
        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to create index for collection '${collectionName}':`, error);
            throw error;
        }
    }

    /**
     * Load collection to memory for searching
     */
    private async loadCollection(collectionName: string): Promise<void> {
        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            await this.makeRequest('/collections/load', 'POST', {
                collectionName,
                dbName: restfulConfig.database
            });
        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to load collection '${collectionName}':`, error);
            throw error;
        }
    }

    async dropCollection(collectionName: string): Promise<void> {
        await this.ensureInitialized();

        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            await this.makeRequest('/collections/drop', 'POST', {
                collectionName,
                dbName: restfulConfig.database
            });
        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to drop collection '${collectionName}':`, error);
            throw error;
        }
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        await this.ensureInitialized();

        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            const response = await this.makeRequest('/collections/has', 'POST', {
                collectionName,
                dbName: restfulConfig.database
            });

            const exists = response.data?.has || false;
            return exists;
        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to check collection '${collectionName}' existence:`, error);
            throw error;
        }
    }

    async listCollections(): Promise<string[]> {
        await this.ensureInitialized();

        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            const response = await this.makeRequest('/collections/list', 'POST', {
                dbName: restfulConfig.database
            });

            return response.data || [];
        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to list collections:`, error);
            throw error;
        }
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            // Transform VectorDocument array to Milvus entity format
            const data = documents.map(doc => ({
                id: doc.id,
                vector: doc.vector,
                content: doc.content,
                relativePath: doc.relativePath,
                startLine: doc.startLine,
                endLine: doc.endLine,
                fileExtension: doc.fileExtension,
                metadata: JSON.stringify(doc.metadata) // Convert metadata object to JSON string
            }));

            const insertRequest = {
                collectionName,
                data,
                dbName: restfulConfig.database
            };

            await this.makeRequest('/entities/insert', 'POST', insertRequest);

        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to insert documents into collection '${collectionName}':`, error);
            throw error;
        }
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        const topK = options?.topK || 10;

        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            // Build search request according to Milvus REST API specification
            const searchRequest: any = {
                collectionName,
                dbName: restfulConfig.database,
                data: [queryVector], // Array of query vectors
                annsField: "vector", // Vector field name
                limit: topK,
                outputFields: [
                    "content",
                    "relativePath",
                    "startLine",
                    "endLine",
                    "fileExtension",
                    "metadata"
                ],
                searchParams: {
                    metricType: "COSINE", // Match the index metric type
                    params: {}
                }
            };

            // Apply boolean expression filter if provided (e.g., fileExtension in ['.ts','.py']) 
            if (options?.filterExpr && options.filterExpr.trim().length > 0) {
                searchRequest.filter = options.filterExpr;
            }

            const response = await this.makeRequest('/entities/search', 'POST', searchRequest);

            // Transform response to VectorSearchResult format
            const results: VectorSearchResult[] = (response.data || []).map((item: any) => {
                // Parse metadata from JSON string
                let metadata = {};
                try {
                    metadata = JSON.parse(item.metadata || '{}');
                } catch (error) {
                    console.warn(`[MilvusRestfulDB] Failed to parse metadata for item ${item.id}:`, error);
                    metadata = {};
                }

                return {
                    document: {
                        id: item.id?.toString() || '',
                        vector: queryVector, // Vector not returned in search results
                        content: item.content || '',
                        relativePath: item.relativePath || '',
                        startLine: item.startLine || 0,
                        endLine: item.endLine || 0,
                        fileExtension: item.fileExtension || '',
                        metadata: metadata
                    },
                    score: item.distance || 0
                };
            });

            return results;

        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to search in collection '${collectionName}':`, error);
            throw error;
        }
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            // Build filter expression for deleting by IDs
            // Format: id in ["id1", "id2", "id3"]
            const filter = `id in [${ids.map(id => `"${id}"`).join(', ')}]`;

            const deleteRequest = {
                collectionName,
                filter,
                dbName: restfulConfig.database
            };

            await this.makeRequest('/entities/delete', 'POST', deleteRequest);

        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to delete documents from collection '${collectionName}':`, error);
            throw error;
        }
    }

    async query(collectionName: string, filter: string, outputFields: string[], limit?: number): Promise<Record<string, any>[]> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            const queryRequest = {
                collectionName,
                dbName: restfulConfig.database,
                filter,
                outputFields,
                limit: limit || 16384, // Use provided limit or default
                offset: 0
            };

            const response = await this.makeRequest('/entities/query', 'POST', queryRequest);

            if (response.code !== 0) {
                throw new Error(`Failed to query Milvus: ${response.message || 'Unknown error'}`);
            }

            return response.data || [];

        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to query collection '${collectionName}':`, error);
            throw error;
        }
    }

    async createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        try {
            const restfulConfig = this.config as MilvusRestfulConfig;

            const collectionSchema = {
                collectionName,
                dbName: restfulConfig.database,
                schema: {
                    enableDynamicField: false,
                    functions: [
                        {
                            name: "content_bm25_emb",
                            description: "content bm25 function",
                            type: "BM25",
                            inputFieldNames: ["content"],
                            outputFieldNames: ["sparse_vector"],
                            params: {},
                        },
                    ],
                    fields: [
                        {
                            fieldName: "id",
                            dataType: "VarChar",
                            isPrimary: true,
                            elementTypeParams: {
                                max_length: 512
                            }
                        },
                        {
                            fieldName: "content",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 65535,
                                enable_analyzer: true
                            }
                        },
                        {
                            fieldName: "vector",
                            dataType: "FloatVector",
                            elementTypeParams: {
                                dim: dimension
                            }
                        },
                        {
                            fieldName: "sparse_vector",
                            dataType: "SparseFloatVector"
                        },
                        {
                            fieldName: "relativePath",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 1024
                            }
                        },
                        {
                            fieldName: "startLine",
                            dataType: "Int64"
                        },
                        {
                            fieldName: "endLine",
                            dataType: "Int64"
                        },
                        {
                            fieldName: "fileExtension",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 32
                            }
                        },
                        {
                            fieldName: "metadata",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 65535
                            }
                        }
                    ]
                }
            };

            // Step 1: Create collection with schema and functions
            await createCollectionWithLimitCheck(this.makeRequest.bind(this), collectionSchema);

            // Step 2: Create indexes for both vector fields
            await this.createHybridIndexes(collectionName);

            // Step 3: Load collection to memory for searching
            await this.loadCollection(collectionName);

        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to create hybrid collection '${collectionName}':`, error);
            throw error;
        }
    }

    private async createHybridIndexes(collectionName: string): Promise<void> {
        try {
            const restfulConfig = this.config as MilvusRestfulConfig;

            // Create index for dense vector
            const denseIndexParams = {
                collectionName,
                dbName: restfulConfig.database,
                indexParams: [
                    {
                        fieldName: "vector",
                        indexName: "vector_index",
                        metricType: "COSINE",
                        index_type: "AUTOINDEX"
                    }
                ]
            };
            await this.makeRequest('/indexes/create', 'POST', denseIndexParams);

            // Create index for sparse vector
            const sparseIndexParams = {
                collectionName,
                dbName: restfulConfig.database,
                indexParams: [
                    {
                        fieldName: "sparse_vector",
                        indexName: "sparse_vector_index",
                        metricType: "BM25",
                        index_type: "SPARSE_INVERTED_INDEX"
                    }
                ]
            };
            await this.makeRequest('/indexes/create', 'POST', sparseIndexParams);

        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to create hybrid indexes for collection '${collectionName}':`, error);
            throw error;
        }
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        try {
            const restfulConfig = this.config as MilvusRestfulConfig;

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

            const insertRequest = {
                collectionName,
                dbName: restfulConfig.database,
                data: data
            };

            const response = await this.makeRequest('/entities/insert', 'POST', insertRequest);

            if (response.code !== 0) {
                throw new Error(`Insert failed: ${response.message || 'Unknown error'}`);
            }

        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to insert hybrid documents to collection '${collectionName}':`, error);
            throw error;
        }
    }

    async hybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options?: HybridSearchOptions): Promise<HybridSearchResult[]> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        try {
            const restfulConfig = this.config as MilvusRestfulConfig;

            console.log(`[MilvusRestfulDB] 🔍 Preparing hybrid search for collection: ${collectionName}`);

            // Prepare search requests according to Milvus REST API hybrid search specification
            // For dense vector search - data must be array of vectors: [[0.1, 0.2, 0.3, ...]]
            const search_param_1: any = {
                data: Array.isArray(searchRequests[0].data) ? [searchRequests[0].data] : [[searchRequests[0].data]],
                annsField: searchRequests[0].anns_field, // "vector"
                limit: searchRequests[0].limit,
                outputFields: ["*"],
                searchParams: {
                    metricType: "COSINE",
                    params: searchRequests[0].param || { "nprobe": 10 }
                }
            };

            // For sparse vector search - data must be array of queries: ["query text"]
            const search_param_2: any = {
                data: Array.isArray(searchRequests[1].data) ? searchRequests[1].data : [searchRequests[1].data],
                annsField: searchRequests[1].anns_field, // "sparse_vector"
                limit: searchRequests[1].limit,
                outputFields: ["*"],
                searchParams: {
                    metricType: "BM25",
                    params: searchRequests[1].param || { "drop_ratio_search": 0.2 }
                }
            };

            // Apply filter to both search parameters if provided
            if (options?.filterExpr && options.filterExpr.trim().length > 0) {
                search_param_1.filter = options.filterExpr;
                search_param_2.filter = options.filterExpr;
            }

            const rerank_strategy = {
                strategy: "rrf",
                params: {
                    k: 100
                }
            };

            console.log(`[MilvusRestfulDB] 🔍 Dense search params:`, JSON.stringify({
                annsField: search_param_1.annsField,
                limit: search_param_1.limit,
                data_length: Array.isArray(search_param_1.data[0]) ? search_param_1.data[0].length : 'N/A',
                searchParams: search_param_1.searchParams
            }, null, 2));
            console.log(`[MilvusRestfulDB] 🔍 Sparse search params:`, JSON.stringify({
                annsField: search_param_2.annsField,
                limit: search_param_2.limit,
                query_text: typeof search_param_2.data[0] === 'string' ? search_param_2.data[0].substring(0, 50) + '...' : 'N/A',
                searchParams: search_param_2.searchParams
            }, null, 2));

            const hybridSearchRequest: any = {
                collectionName,
                dbName: restfulConfig.database,
                search: [search_param_1, search_param_2],
                rerank: rerank_strategy,
                limit: options?.limit || searchRequests[0]?.limit || 10,
                outputFields: ['id', 'content', 'relativePath', 'startLine', 'endLine', 'fileExtension', 'metadata'],
            };

            console.log(`[MilvusRestfulDB] 🔍 Executing REST API hybrid search...`);
            const response = await this.makeRequest('/entities/hybrid_search', 'POST', hybridSearchRequest);

            if (response.code !== 0) {
                throw new Error(`Hybrid search failed: ${response.message || 'Unknown error'}`);
            }

            const results = response.data || [];
            console.log(`[MilvusRestfulDB] ✅ Found ${results.length} results from hybrid search`);

            // Transform response to HybridSearchResult format
            return results.map((result: any) => ({
                document: {
                    id: result.id,
                    content: result.content,
                    vector: [], // Vector not returned in search results
                    sparse_vector: [], // Vector not returned in search results
                    relativePath: result.relativePath,
                    startLine: result.startLine,
                    endLine: result.endLine,
                    fileExtension: result.fileExtension,
                    metadata: JSON.parse(result.metadata || '{}'),
                },
                score: result.score || result.distance || 0,
            }));

        } catch (error) {
            console.error(`[MilvusRestfulDB] ❌ Failed to perform hybrid search on collection '${collectionName}':`, error);
            throw error;
        }
    }

    /**
     * Check collection limit
     * Returns true if collection can be created, false if limit exceeded
     * TODO: Implement proper collection limit checking for REST API
     */
    async checkCollectionLimit(): Promise<boolean> {
        // TODO: Implement REST API version of collection limit checking
        // For now, always return true to maintain compatibility
        console.warn('[MilvusRestfulDB] ⚠️  checkCollectionLimit not implemented for REST API - returning true');
        return true;
    }
}