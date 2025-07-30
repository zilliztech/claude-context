import {
    VectorDocument,
    SearchOptions,
    VectorSearchResult,
    VectorDatabase,
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
            console.error(`Milvus REST API request failed:`, error);
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
            console.error(`❌ Failed to create collection '${collectionName}':`, error);
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
            console.error(`❌ Failed to create index for collection '${collectionName}':`, error);
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
            console.error(`❌ Failed to load collection '${collectionName}':`, error);
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
            console.error(`❌ Failed to drop collection '${collectionName}':`, error);
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
            console.error(`❌ Failed to check collection '${collectionName}' existence:`, error);
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
            console.error(`❌ Failed to list collections:`, error);
            throw error;
        }
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.ensureInitialized();

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
            console.error(`❌ Failed to insert documents into collection '${collectionName}':`, error);
            throw error;
        }
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        await this.ensureInitialized();

        const topK = options?.topK || 10;

        try {
            const restfulConfig = this.config as MilvusRestfulConfig;
            // Build search request according to Milvus REST API specification
            const searchRequest = {
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

            const response = await this.makeRequest('/entities/search', 'POST', searchRequest);

            // Transform response to VectorSearchResult format
            const results: VectorSearchResult[] = (response.data || []).map((item: any) => {
                // Parse metadata from JSON string
                let metadata = {};
                try {
                    metadata = JSON.parse(item.metadata || '{}');
                } catch (error) {
                    console.warn(`Failed to parse metadata for item ${item.id}:`, error);
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
            console.error(`❌ Failed to search in collection '${collectionName}':`, error);
            throw error;
        }
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        await this.ensureInitialized();

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
            console.error(`❌ Failed to delete documents from collection '${collectionName}':`, error);
            throw error;
        }
    }

    async query(collectionName: string, filter: string, outputFields: string[], limit?: number): Promise<Record<string, any>[]> {
        await this.ensureInitialized();

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
            console.error(`❌ Failed to query collection '${collectionName}':`, error);
            throw error;
        }
    }
}