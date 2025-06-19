import { VectorDatabase, VectorDocument, SearchOptions, VectorSearchResult } from './index';

export interface MilvusRestfulConfig {
    address: string;
    token?: string;
    username?: string;
    password?: string;
    database?: string;
}

/**
 * Milvus Vector Database implementation using REST API
 * This implementation is designed for environments where gRPC is not available,
 * such as VSCode extensions or browser environments.
 */
export class MilvusRestfulVectorDatabase implements VectorDatabase {
    private config: MilvusRestfulConfig;
    private baseUrl: string;

    constructor(config: MilvusRestfulConfig) {
        this.config = config;

        // Ensure address has protocol prefix
        let address = config.address;
        if (!address.startsWith('http://') && !address.startsWith('https://')) {
            address = `http://${address}`;
        }

        this.baseUrl = address.replace(/\/$/, '') + '/v2/vectordb';

        console.log(`🔌 Connecting to Milvus REST API at: ${address}`);
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
        try {
            // Build collection schema based on the original milvus-vectordb.ts implementation
            // Note: REST API doesn't support description parameter in collection creation
            // Unlike gRPC version, the description parameter is ignored in REST API
            const collectionSchema = {
                collectionName,
                dbName: this.config.database,
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
            await this.makeRequest('/collections/create', 'POST', collectionSchema);

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
            const indexParams = {
                collectionName,
                dbName: this.config.database,
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
            await this.makeRequest('/collections/load', 'POST', {
                collectionName,
                dbName: this.config.database
            });
        } catch (error) {
            console.error(`❌ Failed to load collection '${collectionName}':`, error);
            throw error;
        }
    }

    async dropCollection(collectionName: string): Promise<void> {
        try {
            await this.makeRequest('/collections/drop', 'POST', {
                collectionName,
                dbName: this.config.database
            });
        } catch (error) {
            console.error(`❌ Failed to drop collection '${collectionName}':`, error);
            throw error;
        }
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        try {
            const response = await this.makeRequest('/collections/has', 'POST', {
                collectionName,
                dbName: this.config.database
            });

            const exists = response.data?.has || false;
            return exists;
        } catch (error) {
            console.error(`❌ Failed to check collection '${collectionName}' existence:`, error);
            throw error;
        }
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        try {
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
                dbName: this.config.database
            };

            await this.makeRequest('/entities/insert', 'POST', insertRequest);

        } catch (error) {
            console.error(`❌ Failed to insert documents into collection '${collectionName}':`, error);
            throw error;
        }
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        const topK = options?.topK || 10;

        try {
            // Build search request according to Milvus REST API specification
            const searchRequest = {
                collectionName,
                dbName: this.config.database,
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
        try {
            // Build filter expression for deleting by IDs
            // Format: id in ["id1", "id2", "id3"]
            const filter = `id in [${ids.map(id => `"${id}"`).join(', ')}]`;

            const deleteRequest = {
                collectionName,
                filter,
                dbName: this.config.database
            };

            await this.makeRequest('/entities/delete', 'POST', deleteRequest);

        } catch (error) {
            console.error(`❌ Failed to delete documents from collection '${collectionName}':`, error);
            throw error;
        }
    }
}