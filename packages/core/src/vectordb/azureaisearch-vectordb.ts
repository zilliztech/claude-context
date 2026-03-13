import {
    SearchClient,
    SearchIndexClient,
    AzureKeyCredential,
    SearchIndex,
    SearchField,
    VectorSearch,
    HnswAlgorithmConfiguration,
    VectorSearchAlgorithmKind,
    VectorSearchProfile,
    SearchIndexerDataSourceConnection,
} from '@azure/search-documents';
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

export interface AzureAISearchConfig {
    endpoint?: string;
    apiKey?: string;
    batchSize?: number; // Number of documents to insert in each batch (default: 100)
    maxRetries?: number; // Maximum number of retries for failed operations (default: 3)
    retryDelayMs?: number; // Delay between retries in milliseconds (default: 1000)
}

interface AzureSearchDocument {
    id: string;
    vector: number[];
    sparseVector?: { [key: string]: number }; // For hybrid search
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    fileExtension: string;
    metadata: string; // JSON stringified
    createdAt: Date;
}

/**
 * Azure AI Search Vector Database implementation
 * This implementation provides vector storage and similarity search using Azure Cognitive Search
 * with support for hybrid search (dense + sparse vectors), semantic ranking, and filtering
 */
export class AzureAISearchVectorDatabase implements VectorDatabase {
    protected config: AzureAISearchConfig;
    private indexClient: SearchIndexClient;
    private searchClients: Map<string, SearchClient<AzureSearchDocument>>;
    protected initializationPromise: Promise<void>;
    private readonly MAX_COLLECTIONS = 50; // Azure AI Search free tier limit

    constructor(config: AzureAISearchConfig) {
        this.config = config;
        this.searchClients = new Map();

        const credential = new AzureKeyCredential(this.config.apiKey || 'undefined');
        this.indexClient = new SearchIndexClient(this.config.endpoint || 'undefined', credential);

        this.initializationPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            console.log('🔌 Connecting to Azure AI Search...');
            // Verify connection by listing indexes
            await this.indexClient.listIndexes().next();
            console.log('✅ Successfully connected to Azure AI Search');
        } catch (error) {
            console.error('❌ Failed to connect to Azure AI Search:', error);
            throw new Error('Failed to initialize Azure AI Search. Please check your endpoint and API key.');
        }
    }

    protected async ensureInitialized(): Promise<void> {
        await this.initializationPromise;
    }

    private getSearchClient(indexName: string): SearchClient<AzureSearchDocument> {
        if (!this.searchClients.has(indexName)) {
            const credential = new AzureKeyCredential(this.config.apiKey || 'undefined');
            const client = new SearchClient<AzureSearchDocument>(
                this.config.endpoint || 'undefined',
                indexName,
                credential
            );
            this.searchClients.set(indexName, client);
        }
        return this.searchClients.get(indexName)!;
    }

    private normalizeIndexName(collectionName: string): string {
        // Azure AI Search index names must be lowercase and contain only letters, digits, or dashes
        // Cannot start or end with dashes, and consecutive dashes are not allowed
        return collectionName
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/--+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 128); // Max length is 128 characters
    }

    async createCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();
        const indexName = this.normalizeIndexName(collectionName);

        try {
            console.log(`📦 Creating Azure AI Search index '${indexName}' with dimension ${dimension}...`);

            const index: SearchIndex = {
                name: indexName,
                fields: [
                    {
                        name: 'id',
                        type: 'Edm.String',
                        key: true,
                        filterable: true,
                        sortable: false,
                        facetable: false,
                        searchable: false,
                    } as SearchField,
                    {
                        name: 'vector',
                        type: 'Collection(Edm.Single)',
                        searchable: true,
                        filterable: false,
                        sortable: false,
                        facetable: false,
                        vectorSearchDimensions: dimension,
                        vectorSearchProfileName: 'vector-profile',
                    } as SearchField,
                    {
                        name: 'content',
                        type: 'Edm.String',
                        searchable: true,
                        filterable: false,
                        sortable: false,
                        facetable: false,
                        analyzerName: 'standard.lucene',
                    } as SearchField,
                    {
                        name: 'relativePath',
                        type: 'Edm.String',
                        searchable: true,
                        filterable: true,
                        sortable: true,
                        facetable: true,
                    } as SearchField,
                    {
                        name: 'startLine',
                        type: 'Edm.Int32',
                        filterable: true,
                        sortable: true,
                        facetable: false,
                    } as SearchField,
                    {
                        name: 'endLine',
                        type: 'Edm.Int32',
                        filterable: true,
                        sortable: true,
                        facetable: false,
                    } as SearchField,
                    {
                        name: 'fileExtension',
                        type: 'Edm.String',
                        filterable: true,
                        sortable: false,
                        facetable: true,
                        searchable: false,
                    } as SearchField,
                    {
                        name: 'metadata',
                        type: 'Edm.String',
                        searchable: false,
                        filterable: false,
                        sortable: false,
                        facetable: false,
                    } as SearchField,
                    {
                        name: 'createdAt',
                        type: 'Edm.DateTimeOffset',
                        filterable: true,
                        sortable: true,
                        facetable: false,
                    } as SearchField,
                ],
                vectorSearch: {
                    algorithms: [
                        {
                            name: 'hnsw-algorithm',
                            kind: "hnsw",
                            hnswParameters: {
                                m: 4,
                                efConstruction: 400,
                                efSearch: 500,
                                metric: 'cosine',
                            },
                        } as HnswAlgorithmConfiguration,
                    ],
                    profiles: [
                        {
                            name: 'vector-profile',
                            algorithmConfigurationName: 'hnsw-algorithm',
                        } as VectorSearchProfile,
                    ],
                } as VectorSearch,
            };

            await this.indexClient.createIndex(index);
            console.log(`✅ Azure AI Search index '${indexName}' created successfully`);
        } catch (error: any) {
            // Check for quota/limit errors
            if (error?.statusCode === 403 || error?.message?.includes('quota') || error?.message?.includes('limit')) {
                console.error('❌ Collection limit exceeded');
                throw new Error(COLLECTION_LIMIT_MESSAGE);
            }
            console.error(`❌ Failed to create index '${indexName}':`, error);
            throw error;
        }
    }

    async createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();
        const indexName = this.normalizeIndexName(collectionName);

        try {
            console.log(`📦 Creating Azure AI Search hybrid index '${indexName}' with dimension ${dimension}...`);

            const index: SearchIndex = {
                name: indexName,
                fields: [
                    {
                        name: 'id',
                        type: 'Edm.String',
                        key: true,
                        filterable: true,
                        sortable: false,
                        facetable: false,
                        searchable: false,
                    } as SearchField,
                    {
                        name: 'vector',
                        type: 'Collection(Edm.Single)',
                        searchable: true,
                        filterable: false,
                        sortable: false,
                        facetable: false,
                        vectorSearchDimensions: dimension,
                        vectorSearchProfileName: 'vector-profile',
                    } as SearchField,
                    {
                        name: 'content',
                        type: 'Edm.String',
                        searchable: true,
                        filterable: false,
                        sortable: false,
                        facetable: false,
                        analyzerName: 'standard.lucene',
                    } as SearchField,
                    {
                        name: 'relativePath',
                        type: 'Edm.String',
                        searchable: true,
                        filterable: true,
                        sortable: true,
                        facetable: true,
                    } as SearchField,
                    {
                        name: 'startLine',
                        type: 'Edm.Int32',
                        filterable: true,
                        sortable: true,
                        facetable: false,
                    } as SearchField,
                    {
                        name: 'endLine',
                        type: 'Edm.Int32',
                        filterable: true,
                        sortable: true,
                        facetable: false,
                    } as SearchField,
                    {
                        name: 'fileExtension',
                        type: 'Edm.String',
                        filterable: true,
                        sortable: false,
                        facetable: true,
                        searchable: false,
                    } as SearchField,
                    {
                        name: 'metadata',
                        type: 'Edm.String',
                        searchable: false,
                        filterable: false,
                        sortable: false,
                        facetable: false,
                    } as SearchField,
                    {
                        name: 'createdAt',
                        type: 'Edm.DateTimeOffset',
                        filterable: true,
                        sortable: true,
                        facetable: false,
                    } as SearchField,
                ],
                vectorSearch: {
                    algorithms: [
                        {
                            name: 'hnsw-algorithm',
                            kind: "hnsw",
                            hnswParameters: {
                                m: 4,
                                efConstruction: 400,
                                efSearch: 500,
                                metric: 'cosine',
                            },
                        } as HnswAlgorithmConfiguration,
                    ],
                    profiles: [
                        {
                            name: 'vector-profile',
                            algorithmConfigurationName: 'hnsw-algorithm',
                        } as VectorSearchProfile,
                    ],
                } as VectorSearch,
            };

            await this.indexClient.createIndex(index);
            console.log(`✅ Azure AI Search hybrid index '${indexName}' created successfully`);
        } catch (error: any) {
            if (error?.statusCode === 403 || error?.message?.includes('quota') || error?.message?.includes('limit')) {
                console.error('❌ Collection limit exceeded');
                throw new Error(COLLECTION_LIMIT_MESSAGE);
            }
            console.error(`❌ Failed to create hybrid index '${indexName}':`, error);
            throw error;
        }
    }

    async dropCollection(collectionName: string): Promise<void> {
        await this.ensureInitialized();
        const indexName = this.normalizeIndexName(collectionName);

        try {
            await this.indexClient.deleteIndex(indexName);
            this.searchClients.delete(indexName);
            console.log(`✅ Azure AI Search index '${indexName}' dropped successfully`);
        } catch (error) {
            console.error(`❌ Failed to drop index '${indexName}':`, error);
            throw error;
        }
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        await this.ensureInitialized();
        const indexName = this.normalizeIndexName(collectionName);

        try {
            await this.indexClient.getIndex(indexName);
            return true;
        } catch (error: any) {
            if (error?.statusCode === 404) {
                return false;
            }
            throw error;
        }
    }

    async listCollections(): Promise<string[]> {
        await this.ensureInitialized();

        try {
            const indexes: string[] = [];
            const indexIterator = this.indexClient.listIndexes();

            for await (const index of indexIterator) {
                indexes.push(index.name);
            }

            return indexes;
        } catch (error) {
            console.error('❌ Failed to list indexes:', error);
            throw error;
        }
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.ensureInitialized();
        const indexName = this.normalizeIndexName(collectionName);

        if (documents.length === 0) {
            return;
        }

        try {
            const searchClient = this.getSearchClient(indexName);
            const batchSize = this.config.batchSize || 100;

            console.log(`📝 Inserting ${documents.length} documents into Azure AI Search index '${indexName}'...`);

            // Process in batches
            for (let i = 0; i < documents.length; i += batchSize) {
                const batch = documents.slice(i, i + batchSize);
                const azureDocs: AzureSearchDocument[] = batch.map(doc => ({
                    id: doc.id,
                    vector: doc.vector,
                    content: doc.content,
                    relativePath: doc.relativePath,
                    startLine: doc.startLine,
                    endLine: doc.endLine,
                    fileExtension: doc.fileExtension,
                    metadata: JSON.stringify(doc.metadata),
                    createdAt: new Date(),
                }));

                const result = await searchClient.uploadDocuments(azureDocs);

                // Check for failures
                const failures = result.results.filter(r => !r.succeeded);
                if (failures.length > 0) {
                    console.warn(`⚠️  ${failures.length} documents failed to insert`);
                    failures.forEach(f => {
                        console.warn(`   Failed: ${f.key} - ${f.errorMessage}`);
                    });
                }

                console.log(`   Batch ${Math.floor(i / batchSize) + 1}: ${result.results.filter(r => r.succeeded).length}/${batch.length} documents inserted`);
            }

            console.log(`✅ Successfully inserted ${documents.length} documents into Azure AI Search index '${indexName}'`);
        } catch (error) {
            console.error(`❌ Failed to insert documents into index '${indexName}':`, error);
            throw error;
        }
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        // For Azure AI Search, hybrid insertion is the same as regular insertion
        // The hybrid search functionality is handled at query time
        await this.insert(collectionName, documents);
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        await this.ensureInitialized();
        const indexName = this.normalizeIndexName(collectionName);

        try {
            const searchClient = this.getSearchClient(indexName);
            const topK = options?.topK || 10;

            console.log(`🔍 Searching Azure AI Search index '${indexName}' with topK=${topK}...`);

            const searchOptions: any = {
                vectorSearchOptions: {
                    queries: [
                        {
                            kind: 'vector',
                            vector: queryVector,
                            fields: ['vector'],
                            kNearestNeighborsCount: topK,
                        },
                    ],
                },
                select: ['id', 'content', 'relativePath', 'startLine', 'endLine', 'fileExtension', 'metadata'],
                top: topK,
            };

            // Add filter if provided
            if (options?.filterExpr) {
                searchOptions.filter = options.filterExpr;
            }

            const searchResults = await searchClient.search('*', searchOptions);
            const results: VectorSearchResult[] = [];

            for await (const result of searchResults.results) {
                if (!result.document) continue;

                const doc = result.document as AzureSearchDocument;
                const score = result.score || 0;

                // Apply threshold if specified
                if (options?.threshold && score < options.threshold) {
                    continue;
                }

                results.push({
                    document: {
                        id: doc.id,
                        vector: queryVector, // Azure doesn't return the stored vector
                        content: doc.content,
                        relativePath: doc.relativePath,
                        startLine: doc.startLine,
                        endLine: doc.endLine,
                        fileExtension: doc.fileExtension,
                        metadata: typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata,
                    },
                    score: score,
                });
            }

            console.log(`✅ Found ${results.length} results from Azure AI Search`);
            return results;
        } catch (error) {
            console.error(`❌ Failed to search index '${indexName}':`, error);
            throw error;
        }
    }

    async hybridSearch(
        collectionName: string,
        searchRequests: HybridSearchRequest[],
        options?: HybridSearchOptions
    ): Promise<HybridSearchResult[]> {
        await this.ensureInitialized();
        const indexName = this.normalizeIndexName(collectionName);

        try {
            console.log(`🔍 Performing hybrid search on Azure AI Search index '${indexName}'...`);

            const searchClient = this.getSearchClient(indexName);
            const limit = options?.limit || 10;

            // Find dense vector request and text request
            const denseRequest = searchRequests.find(req => req.anns_field === 'vector');
            const textRequest = searchRequests.find(req => req.anns_field === 'sparse_vector' || typeof req.data === 'string');

            if (!denseRequest) {
                throw new Error('Hybrid search requires at least a dense vector request');
            }

            const searchOptions: any = {
                select: ['id', 'content', 'relativePath', 'startLine', 'endLine', 'fileExtension', 'metadata'],
                top: limit,
            };

            // Add vector search
            if (Array.isArray(denseRequest.data)) {
                searchOptions.vectorSearchOptions = {
                    queries: [
                        {
                            kind: 'vector',
                            vector: denseRequest.data,
                            fields: ['vector'],
                            kNearestNeighborsCount: limit * 2, // Retrieve more for reranking
                        },
                    ],
                };
            }

            // Add filter if provided
            if (options?.filterExpr) {
                searchOptions.filter = options.filterExpr;
            }

            // Determine search query
            let searchQuery = '*';
            if (textRequest && typeof textRequest.data === 'string') {
                searchQuery = textRequest.data;
                searchOptions.searchFields = ['content', 'relativePath'];
                searchOptions.queryType = 'full'; // Enable full text search with ranking
            }

            // Execute search
            const searchResults = await searchClient.search(searchQuery, searchOptions);
            const results: HybridSearchResult[] = [];

            for await (const result of searchResults.results) {
                if (!result.document) continue;

                const doc = result.document as AzureSearchDocument;

                // Azure AI Search automatically combines vector and text search scores
                const score = result.score || 0;

                results.push({
                    document: {
                        id: doc.id,
                        vector: Array.isArray(denseRequest.data) ? denseRequest.data : [],
                        content: doc.content,
                        relativePath: doc.relativePath,
                        startLine: doc.startLine,
                        endLine: doc.endLine,
                        fileExtension: doc.fileExtension,
                        metadata: typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata,
                    },
                    score: score,
                });

                if (results.length >= limit) {
                    break;
                }
            }

            // Apply reranking if specified
            if (options?.rerank) {
                results.sort((a, b) => b.score - a.score);
            }

            console.log(`✅ Hybrid search completed: ${results.length} results found`);
            return results.slice(0, limit);
        } catch (error) {
            console.error(`❌ Failed to perform hybrid search on index '${indexName}':`, error);
            throw error;
        }
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        await this.ensureInitialized();
        const indexName = this.normalizeIndexName(collectionName);

        if (ids.length === 0) {
            return;
        }

        try {
            const searchClient = this.getSearchClient(indexName);


            const result = await searchClient.deleteDocuments("id", ids);

            const successCount = result.results.filter(r => r.succeeded).length;
            console.log(`✅ Deleted ${successCount} documents from Azure AI Search index '${indexName}'`);
        } catch (error) {
            console.error(`❌ Failed to delete documents from index '${indexName}':`, error);
            throw error;
        }
    }

    async query(
        collectionName: string,
        filter: string,
        outputFields: string[],
        limit?: number
    ): Promise<Record<string, any>[]> {
        await this.ensureInitialized();
        const indexName = this.normalizeIndexName(collectionName);

        try {
            const searchClient = this.getSearchClient(indexName);
            const queryLimit = limit || 100;

            console.log(`🔍 Querying Azure AI Search index '${indexName}' with filter...`);

            const searchOptions: any = {
                filter: filter,
                select: outputFields.length > 0 ? outputFields : ['*'],
                top: queryLimit,
            };

            const searchResults = await searchClient.search('*', searchOptions);
            const results: Record<string, any>[] = [];

            for await (const result of searchResults.results) {
                if (!result.document) continue;

                const doc = result.document as any;
                const mapped: Record<string, any> = {};

                for (const field of outputFields) {
                    if (doc[field] !== undefined) {
                        // Parse metadata if it's a JSON string
                        if (field === 'metadata' && typeof doc[field] === 'string') {
                            mapped[field] = JSON.parse(doc[field]);
                        } else {
                            mapped[field] = doc[field];
                        }
                    }
                }

                results.push(mapped);
            }

            console.log(`✅ Query completed: ${results.length} results found`);
            return results;
        } catch (error) {
            console.error(`❌ Failed to query index '${indexName}':`, error);
            throw error;
        }
    }

    async checkCollectionLimit(): Promise<boolean> {
        await this.ensureInitialized();

        try {
            const indexes = await this.listCollections();
            const canCreateMore = indexes.length < this.MAX_COLLECTIONS;

            if (!canCreateMore) {
                console.warn(`⚠️  Collection limit reached: ${indexes.length}/${this.MAX_COLLECTIONS}`);
            }

            return canCreateMore;
        } catch (error) {
            console.error('❌ Failed to check collection limit:', error);
            return false;
        }
    }

    /**
     * Get statistics for a collection
     */
    async getCollectionStats(collectionName: string): Promise<{ entityCount: number }> {
        await this.ensureInitialized();
        const indexName = this.normalizeIndexName(collectionName);

        try {
            const searchClient = this.getSearchClient(indexName);

            // Azure AI Search doesn't provide direct count API in newer versions
            // We need to perform a search with top=0 to get the count
            const result = await searchClient.search('*', {
                includeTotalCount: true,
                top: 0,
            });

            const count = result.count || 0;
            return { entityCount: count };
        } catch (error) {
            console.error(`❌ Failed to get stats for index '${indexName}':`, error);
            throw error;
        }
    }

    /**
     * Clean up resources
     */
    async close(): Promise<void> {
        this.searchClients.clear();
        console.log('🔌 Azure AI Search clients closed');
    }
}