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
}

export interface VectorSearchResult {
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
     * Insert vector documents
     * @param collectionName Collection name
     * @param documents Document array
     */
    insert(collectionName: string, documents: VectorDocument[]): Promise<void>;

    /**
     * Search similar vectors
     * @param collectionName Collection name
     * @param queryVector Query vector
     * @param options Search options
     */
    search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]>;

    /**
     * Delete documents
     * @param collectionName Collection name
     * @param ids Document ID array
     */
    delete(collectionName: string, ids: string[]): Promise<void>;
}

// Implementation class exports
export * from './milvus-restful-vectordb';
export * from './milvus-vectordb'; 