// Interface definitions
export interface VectorDocument {
    id: string;
    vector: number[];
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    fileExtension: string;
    metadata: Record<string, any>;
}

export interface SearchOptions {
    topK?: number;
    filter?: Record<string, any>;
    threshold?: number;
    filterExpr?: string;
}

// New interfaces for hybrid search
export interface HybridSearchRequest {
    data: number[] | string; // Query vector or text
    anns_field: string; // Vector field name (vector or sparse_vector)
    param: Record<string, any>; // Search parameters
    limit: number;
}

export interface HybridSearchOptions {
    rerank?: RerankStrategy;
    limit?: number;
    filterExpr?: string;
}

export interface RerankStrategy {
    strategy: 'rrf' | 'weighted';
    params?: Record<string, any>;
}

export interface VectorSearchResult {
    document: VectorDocument;
    score: number;
}

export interface HybridSearchResult {
    document: VectorDocument;
    score: number;
}

export interface VectorDatabase {
    /**
     * Create collection
     * @param collectionName Collection name
     * @param dimension Vector dimension
     * @param description Collection description
     */
    createCollection(collectionName: string, dimension: number, description?: string): Promise<void>;

    /**
     * Create collection with hybrid search support
     * @param collectionName Collection name
     * @param dimension Dense vector dimension
     * @param description Collection description
     */
    createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void>;

    /**
     * Drop collection
     * @param collectionName Collection name
     */
    dropCollection(collectionName: string): Promise<void>;

    /**
     * Check if collection exists
     * @param collectionName Collection name
     */
    hasCollection(collectionName: string): Promise<boolean>;

    /**
     * List all collections
     */
    listCollections(): Promise<string[]>;

    /**
     * Insert vector documents
     * @param collectionName Collection name
     * @param documents Document array
     */
    insert(collectionName: string, documents: VectorDocument[]): Promise<void>;

    /**
     * Insert hybrid vector documents
     * @param collectionName Collection name
     * @param documents Document array
     */
    insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void>;

    /**
     * Search similar vectors
     * @param collectionName Collection name
     * @param queryVector Query vector
     * @param options Search options
     */
    search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]>;

    /**
     * Hybrid search with multiple vector fields
     * @param collectionName Collection name
     * @param searchRequests Array of search requests for different fields
     * @param options Hybrid search options including reranking
     */
    hybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options?: HybridSearchOptions): Promise<HybridSearchResult[]>;

    /**
     * Delete documents
     * @param collectionName Collection name
     * @param ids Document ID array
     */
    delete(collectionName: string, ids: string[]): Promise<void>;

    /**
     * Query documents with filter conditions
     * @param collectionName Collection name
     * @param filter Filter expression
     * @param outputFields Fields to return
     * @param limit Maximum number of results
     */
    query(collectionName: string, filter: string, outputFields: string[], limit?: number): Promise<Record<string, any>[]>;

    /**
     * Check collection limit
     * Returns true if collection can be created, false if limit exceeded
     */
    checkCollectionLimit(): Promise<boolean>;
}

/**
 * Special error message for collection limit exceeded
 * This allows us to distinguish it from other errors across all Milvus implementations
 */
export const COLLECTION_LIMIT_MESSAGE = "[Error]: Your Zilliz Cloud account has hit its collection limit. To continue creating collections, you'll need to expand your capacity. We recommend visiting https://zilliz.com/pricing to explore options for dedicated or serverless clusters."; 