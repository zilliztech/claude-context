import { QdrantClient } from '@qdrant/js-client-rest';
import type { Schemas } from '@qdrant/js-client-rest/dist/types/types';
import * as crypto from 'crypto';
import {
    VectorDatabase,
    VectorDocument,
    SearchOptions,
    VectorSearchResult,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult,
    RerankStrategy
} from './types';

type ScoredPoint = Schemas['ScoredPoint'];
type ScrollResult = Schemas['ScrollResult'];

export interface QdrantQuantizationConfig {
    type: 'scalar' | 'binary' | 'product';
    quantile?: number;
    always_ram?: boolean;
    compression?: number;
    oversampling?: number;
}

export interface QdrantHNSWConfig {
    m?: number;                    // Number of edges per node (default 16)
    ef_construct?: number;         // Size of the dynamic candidate list (default 100)  
    full_scan_threshold?: number;  // Vectors count threshold for full scan (default 10000)
    on_disk?: boolean;            // Store HNSW index on disk
}

export interface QdrantSparseIndexConfig {
    on_disk?: boolean;            // Store sparse index on disk
    datatype?: 'float32' | 'uint8';  // Datatype for index
}

export interface QdrantBM25Config {
    k1?: number;    // Controls term frequency saturation (default: 1.2)
    b?: number;     // Controls document length normalization (default: 0.75)
    min_word_len?: number;  // Minimum word length to index (default: 3)
    max_vocab_size?: number; // Maximum vocabulary size (default: 50000)
}

export interface QdrantConfig {
    url: string;
    apiKey?: string;
    timeout?: number;
    quantization?: QdrantQuantizationConfig;
    indexing?: {
        hnsw?: QdrantHNSWConfig;
        sparse?: QdrantSparseIndexConfig;
    };
    bm25?: QdrantBM25Config;
}

/**
 * Simple vocabulary management for BM25 scoring
 */
class VocabularyManager {
    private vocabulary = new Map<string, number>(); // word -> index
    private wordCounts = new Map<string, number>(); // word -> frequency
    private docCount = 0;
    private config: QdrantBM25Config;

    constructor(config: QdrantBM25Config) {
        this.config = {
            k1: 1.2,
            b: 0.75,
            min_word_len: 3,
            max_vocab_size: 50000,
            ...config
        };
    }

    /**
     * Simple tokenization - just split and filter
     */
    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length >= this.config.min_word_len!);
    }

    /**
     * Add document to vocabulary
     */
    addDocument(text: string): void {
        const tokens = this.tokenize(text);
        const uniqueWords = new Set(tokens);
        
        this.docCount++;

        for (const word of uniqueWords) {
            if (!this.vocabulary.has(word) && this.vocabulary.size < this.config.max_vocab_size!) {
                this.vocabulary.set(word, this.vocabulary.size);
            }
            this.wordCounts.set(word, (this.wordCounts.get(word) || 0) + 1);
        }
    }

    /**
     * Generate simple sparse vector (just term frequency)
     */
    generateBM25Vector(text: string): { indices: number[]; values: number[] } {
        const tokens = this.tokenize(text);
        const termFreqs = new Map<string, number>();
        
        // Count term frequencies
        for (const token of tokens) {
            termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
        }

        const indices: number[] = [];
        const values: number[] = [];

        for (const [word, tf] of termFreqs.entries()) {
            const vocabIndex = this.vocabulary.get(word);
            if (vocabIndex !== undefined) {
                indices.push(vocabIndex);
                values.push(tf); // Just use term frequency
            }
        }

        return { indices, values };
    }
}

export class QdrantVectorDatabase implements VectorDatabase {
    private client: QdrantClient | null = null;
    private config: QdrantConfig;
    private vocabularyManagers = new Map<string, VocabularyManager>(); // collection -> vocab manager
    private initializationPromise: Promise<void>;

    constructor(config: QdrantConfig) {
        this.config = config;
        // Start initialization asynchronously without waiting
        this.initializationPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        console.log(`[QdrantDB] 🔌 Connecting to vector database at: ${this.config.url}`);
        this.client = new QdrantClient({
            url: this.config.url,
            apiKey: this.config.apiKey,
        });
    }

    /**
     * Ensure initialization is complete before method execution
     */
    private async ensureInitialized(): Promise<void> {
        await this.initializationPromise;
        if (!this.client) {
            throw new Error('QdrantClient is not initialized.');
        }
    }

    /**
     * Simple retry wrapper for collection operations with exponential backoff
     */
    private async withRetry<T>(
        operation: () => Promise<T>,
        operationName: string,
        maxRetries: number = 3,
        initialDelay: number = 1000
    ): Promise<T> {
        let lastError: Error;
        let delay = initialDelay;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                
                // Don't retry on business logic errors (like collection already exists)
                if (lastError.message.includes('already exists') || 
                    lastError.message.includes('not found') ||
                    attempt === maxRetries) {
                    throw lastError;
                }

                console.log(`[QdrantDB] ⚠️  ${operationName} failed (attempt ${attempt}/${maxRetries}): ${lastError.message}`);
                console.log(`[QdrantDB] 🔄 Retrying in ${delay}ms...`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
            }
        }

        throw lastError!;
    }

    /**
     * Get or create vocabulary manager for a collection
     */
    private getVocabularyManager(collectionName: string): VocabularyManager {
        if (!this.vocabularyManagers.has(collectionName)) {
            this.vocabularyManagers.set(
                collectionName, 
                new VocabularyManager(this.config.bm25 || {})
            );
        }
        return this.vocabularyManagers.get(collectionName)!;
    }

    async createCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();

        try {
            // Prepare vector configuration with HNSW optimization
            const vectorConfig: any = {
                size: dimension,
                distance: 'Cosine'
            };

            // Add HNSW configuration if specified
            if (this.config.indexing?.hnsw) {
                const hnswConfig = this.config.indexing.hnsw;
                vectorConfig.hnsw_config = {
                    m: hnswConfig.m || 16,
                    ef_construct: hnswConfig.ef_construct || 100,
                    full_scan_threshold: hnswConfig.full_scan_threshold || 10000,
                    on_disk: hnswConfig.on_disk || false
                };
                console.log(`[QdrantDB] 🔧 Using HNSW config:`, vectorConfig.hnsw_config);
            }

            // Add quantization configuration if specified
            if (this.config.quantization) {
                const quantConfig = this.config.quantization;
                if (quantConfig.type === 'scalar') {
                    vectorConfig.quantization_config = {
                        scalar: {
                            type: 'int8',
                            quantile: quantConfig.quantile || 0.99,
                            always_ram: quantConfig.always_ram || false
                        }
                    };
                } else if (quantConfig.type === 'binary') {
                    vectorConfig.quantization_config = {
                        binary: {
                            always_ram: quantConfig.always_ram || false
                        }
                    };
                }
                console.log(`[QdrantDB] 🗜️  Using ${quantConfig.type} quantization`);
            }

            const collectionConfig: any = {
                vectors: vectorConfig,
                shard_number: 1,
                replication_factor: 1,
            };

            await this.withRetry(
                () => this.client!.createCollection(collectionName, collectionConfig),
                `Create collection '${collectionName}'`
            );
            console.log(`[QdrantDB] ✅ Collection '${collectionName}' created successfully`);
            
        } catch (error) {
            console.error(`[QdrantDB] ❌ Failed to create collection '${collectionName}':`, error);
            throw error;
        }
    }

    async createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();

        try {
            console.log(`[QdrantDB] 🔧 Creating optimized hybrid collection '${collectionName}' with dense (${dimension}D) + sparse vectors...`);
            
            // Prepare dense vector configuration with optimizations
            const denseVectorConfig: any = {
                size: dimension,
                distance: 'Cosine'
            };

            // Add HNSW configuration for dense vectors
            if (this.config.indexing?.hnsw) {
                const hnswConfig = this.config.indexing.hnsw;
                denseVectorConfig.hnsw_config = {
                    m: hnswConfig.m || 16,
                    ef_construct: hnswConfig.ef_construct || 100,
                    full_scan_threshold: hnswConfig.full_scan_threshold || 10000,
                    on_disk: hnswConfig.on_disk || false
                };
                console.log(`[QdrantDB] 🔧 Dense vector HNSW config:`, denseVectorConfig.hnsw_config);
            }

            // Add quantization configuration for dense vectors
            if (this.config.quantization) {
                const quantConfig = this.config.quantization;
                if (quantConfig.type === 'scalar') {
                    denseVectorConfig.quantization_config = {
                        scalar: {
                            type: 'int8',
                            quantile: quantConfig.quantile || 0.99,
                            always_ram: quantConfig.always_ram || false
                        }
                    };
                } else if (quantConfig.type === 'binary') {
                    denseVectorConfig.quantization_config = {
                        binary: {
                            always_ram: quantConfig.always_ram || false
                        }
                    };
                }
                console.log(`[QdrantDB] 🗜️  Dense vector using ${quantConfig.type} quantization`);
            }

            // Prepare sparse vector configuration
            const sparseVectorConfig: any = {
                index: {
                    on_disk: this.config.indexing?.sparse?.on_disk ?? true, // Default on disk for memory efficiency
                }
            };

            // Add datatype configuration for sparse vectors if specified
            if (this.config.indexing?.sparse?.datatype) {
                sparseVectorConfig.index.datatype = this.config.indexing.sparse.datatype;
            }

            console.log(`[QdrantDB] 🗂️  Sparse vector config:`, sparseVectorConfig);

            const collectionConfig: any = {
                vectors: {
                    dense: denseVectorConfig,
                },
                sparse_vectors: {
                    sparse: sparseVectorConfig
                },
                shard_number: 1,
                replication_factor: 1,
            };

            await this.withRetry(
                () => this.client!.createCollection(collectionName, collectionConfig),
                `Create hybrid collection '${collectionName}'`
            );
            console.log(`[QdrantDB] ✅ Hybrid collection '${collectionName}' created successfully`);
            console.log(`[QdrantDB] 📊 Features: Dense vectors (${dimension}D, HNSW + ${this.config.quantization?.type || 'no'} quantization) + Sparse vectors (BM25, ${sparseVectorConfig.index.on_disk ? 'on-disk' : 'in-memory'})`);
            
        } catch (error) {
            console.error(`[QdrantDB] ❌ Failed to create optimized hybrid collection '${collectionName}':`, error);
            throw error;
        }
    }

    async dropCollection(collectionName: string): Promise<void> {
        await this.ensureInitialized();

        try {
            await this.client!.deleteCollection(collectionName);
            console.log(`[QdrantDB] ✅ Collection '${collectionName}' deleted successfully`);
        } catch (error) {
            console.error(`[QdrantDB] ❌ Failed to delete collection '${collectionName}':`, error);
            throw error;
        }
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        await this.ensureInitialized();

        try {
            await this.client!.getCollection(collectionName);
            return true;
        } catch (error) {
            return false;
        }
    }

    async listCollections(): Promise<string[]> {
        await this.ensureInitialized();

        try {
            const result = await this.client!.getCollections();
            return result.collections.map(c => c.name);
        } catch (error) {
            console.error('[QdrantDB] ❌ Failed to list collections:', error);
            throw error;
        }
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        if (documents.length === 0) {
            return;
        }

        await this.ensureInitialized();

        try {
            // Verify collection exists and supports single vector format
            const collectionExists = await this.hasCollection(collectionName);
            if (!collectionExists) {
                throw new Error(`Collection '${collectionName}' does not exist`);
            }

            const points = documents.map(doc => ({
                id: doc.id,
                vector: doc.vector,
                payload: {
                    content: doc.content,
                    relativePath: doc.relativePath,
                    startLine: doc.startLine,
                    endLine: doc.endLine,
                    fileExtension: doc.fileExtension,
                    // Flatten metadata into payload
                    ...doc.metadata
                }
            }));

            await this.client!.upsert(collectionName, {
                points: points
            });

            console.log(`[QdrantDB] ✅ Inserted ${documents.length} documents into collection '${collectionName}'`);
        } catch (error) {
            console.error(`[QdrantDB] ❌ Failed to insert documents into collection '${collectionName}':`, error);
            throw error;
        }
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        if (documents.length === 0) {
            console.log(`[QdrantDB] ⚠️  No documents to insert, returning early`);
            return;
        }

        await this.ensureInitialized();
        console.log(`[QdrantDB] 🔄 Starting insertion of ${documents.length} documents into collection '${collectionName}'`);

        try {
            const collectionExists = await this.hasCollection(collectionName);
            if (!collectionExists) {
                throw new Error(`Collection '${collectionName}' does not exist`);
            }

            // Verify the collection supports hybrid vectors (has sparse vector configuration)
            const collectionInfo = await this.client!.getCollection(collectionName);
            const config = collectionInfo.config as any; // Cast to any to access sparse_vectors
            
            // Check if sparse_vectors exists in the collection config
            // The structure should be config.params.sparse_vectors.sparse
            const sparseVectors = config?.params?.sparse_vectors || config?.sparse_vectors;
            const hasSparseName = sparseVectors && Object.keys(sparseVectors).includes('sparse');
            
            console.log(`[QdrantDB] 🔍 Collection config check:`, {
                hasParams: !!config?.params,
                hasSparseVectors: !!sparseVectors,
                sparseVectorKeys: sparseVectors ? Object.keys(sparseVectors) : [],
                hasSparseName
            });
            
            if (!hasSparseName) {
                throw new Error(`Collection '${collectionName}' exists but does not support sparse vectors. Please use createHybridCollection() or delete and recreate the collection.`);
            }

            console.log(`[QdrantDB] ✅ Collection '${collectionName}' exists with hybrid vector support`);

            if (documents.length > 0) {
                const firstDoc = documents[0];
                console.log(`[QdrantDB] 📄 First document sample:`, {
                    id: firstDoc.id,
                    vectorType: typeof firstDoc.vector,
                    vectorLength: Array.isArray(firstDoc.vector) ? firstDoc.vector.length : 'not array',
                    vectorSample: Array.isArray(firstDoc.vector) ? firstDoc.vector.slice(0, 5) : firstDoc.vector,
                    contentLength: firstDoc.content?.length || 0,
                    relativePath: firstDoc.relativePath,
                    fileExtension: firstDoc.fileExtension
                });
            }

            const points = documents.map((doc, index) => {
                if (!Array.isArray(doc.vector)) {
                    console.error(`[QdrantDB] ❌ Document ${index} has invalid vector:`, typeof doc.vector);
                    throw new Error(`Document ${index} (${doc.id}) has non-array vector`);
                }
                
                if (doc.vector.length === 0) {
                    console.error(`[QdrantDB] ❌ Document ${index} has empty vector`);
                    throw new Error(`Document ${index} (${doc.id}) has empty vector`);
                }

                // Generate BM25 sparse vector using vocabulary manager
                const vocabManager = this.getVocabularyManager(collectionName);
                
                // First pass: add document to vocabulary for IDF calculation
                vocabManager.addDocument(doc.content);
                
                // Second pass: generate BM25 vector
                const sparseVector = vocabManager.generateBM25Vector(doc.content);
                console.log(`[QdrantDB] 🔤 Generated BM25 sparse vector for doc ${index}: ${sparseVector.indices.length} dimensions`);

                return {
                    id: doc.id,
                    vector: { 
                        dense: doc.vector,  // Dense embedding vector
                        sparse: {
                            indices: sparseVector.indices,
                            values: sparseVector.values
                        }
                    },
                    payload: {
                        content: doc.content,
                        relativePath: doc.relativePath,
                        startLine: doc.startLine,
                        endLine: doc.endLine,
                        fileExtension: doc.fileExtension,
                        // Include other metadata except sparseVector (already used above)
                        ...Object.fromEntries(
                            Object.entries(doc.metadata).filter(([key]) => key !== 'sparseVector')
                        )
                    }
                };
            });

            console.log(`[QdrantDB] 📦 Prepared ${points.length} points for insertion`);
            console.log(`[QdrantDB] 🔍 Sample point structure:`, {
                id: points[0].id,
                vectorType: typeof points[0].vector,
                vectorDenseLength: points[0].vector.dense?.length || 'no dense field',
                payloadKeys: Object.keys(points[0].payload)
            });

            const result = await this.client!.upsert(collectionName, { points });
            console.log(`[QdrantDB] ✅ Upsert call completed`);
            console.log(`[QdrantDB] 📊 Upsert response:`, JSON.stringify(result, null, 2));

            if (result && result.status === 'acknowledged') {
                console.log(`[QdrantDB] 🔍 Qdrant acknowledged insertion of ${documents.length} points`);

                try {
                    const collectionInfo = await this.client!.getCollection(collectionName);
                    console.log(`[QdrantDB] 📊 Collection points count after insertion: ${collectionInfo.points_count}`);
                } catch (checkError) {
                    console.warn(`[QdrantDB] ⚠️  Failed to verify points count:`, checkError);
                }
            } else {
                console.warn(`[QdrantDB] ⚠️  Unexpected Qdrant response:`, result);
            }
        } catch (error) {
            console.error(`[QdrantDB] ❌ Failed to insert hybrid documents into collection '${collectionName}':`, error);
            console.error(`[QdrantDB] 📊 Attempted to insert ${documents.length} documents`);
            if (documents.length > 0) {
                console.error(`[QdrantDB] 🔍 First document details:`, {
                    id: documents[0].id,
                    contentLength: documents[0].content?.length || 0,
                    vectorLength: Array.isArray(documents[0].vector) ? documents[0].vector.length : 'not array',
                    vectorType: typeof documents[0].vector,
                    metadataKeys: Object.keys(documents[0].metadata || {})
                });
            }
            throw error;
        }
    }

    /**
     * Generate a valid ID for Qdrant
     * Qdrant requires IDs to be either integers or UUIDs
     * @param originalId Combined string from Context (path:startLine:endLine:content)
     */
    generateId(originalId: string): string {
        const hash = crypto.createHash('md5').update(originalId).digest('hex');

        // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        const uuid = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
        return uuid;
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        await this.ensureInitialized();

        try {
            const isHybridCollection = collectionName.startsWith('hybrid_');

            const searchRequest: any = {
                vector: isHybridCollection ? {
                    name: "dense",
                    vector: queryVector
                } : queryVector,
                limit: options?.topK || 10,
                with_payload: true
            };

            if (options?.filterExpr) {
                searchRequest.filter = options.filterExpr;
            }
            
            const result = await this.client!.search(collectionName, searchRequest);
            
            return result.map((point: ScoredPoint) => ({
                document: {
                    id: point.id.toString(),
                    vector: [], // Qdrant doesn't return vectors in search by default
                    content: point.payload?.content as string,
                    relativePath: point.payload?.relativePath as string,
                    startLine: point.payload?.startLine as number,
                    endLine: point.payload?.endLine as number,
                    fileExtension: point.payload?.fileExtension as string,
                    metadata: this.extractMetadata(point.payload || {})
                },
                score: point.score || 0
            }));
        } catch (error) {
            console.error(`[QdrantDB] ❌ Failed to search collection '${collectionName}':`, error);
            throw error;
        }
    }

    async hybridSearch(
        collectionName: string, 
        searchRequests: HybridSearchRequest[], 
        options?: HybridSearchOptions
    ): Promise<HybridSearchResult[]> {
        await this.ensureInitialized();

        try {
            if (searchRequests.length === 0) {
                console.log(`[QdrantDB] ⚠️  No search requests provided`);
                return [];
            }

            console.log(`[QdrantDB] 🔍 Executing native Qdrant hybrid search for collection: ${collectionName}`);
            console.log(`[QdrantDB] 🔍 Using Query API with ${searchRequests.length} search requests`);

            // Prepare prefetch queries for multi-stage retrieval
            const prefetchQueries = [];
            
            for (let i = 0; i < searchRequests.length; i++) {
                const request = searchRequests[i];
                const isDenseVector = request.anns_field === 'vector' || request.anns_field === 'dense';
                
                if (isDenseVector) {
                    // Dense vector prefetch
                    const queryVector = Array.isArray(request.data) ? request.data : [];
                    prefetchQueries.push({
                        prefetch: [],
                        query: queryVector,
                        using: "dense",
                        limit: Math.max(request.limit * 3, 100), // Get more candidates for better fusion
                        with_payload: true
                    });
                    console.log(`[QdrantDB] 🔍 Added dense vector prefetch: ${queryVector.length}D vector`);
                } else {
                    // Sparse vector prefetch using BM25
                    const queryText = typeof request.data === 'string' ? request.data : '';
                    const vocabManager = this.getVocabularyManager(collectionName);
                    const querySparseVector = vocabManager.generateBM25Vector(queryText);
                    
                    prefetchQueries.push({
                        prefetch: [],
                        query: {
                            indices: querySparseVector.indices,
                            values: querySparseVector.values
                        },
                        using: "sparse",
                        limit: Math.max(request.limit * 3, 100), // Get more candidates for better fusion
                        with_payload: true
                    });
                    console.log(`[QdrantDB] 🔍 Added sparse vector prefetch: ${querySparseVector.indices.length} dimensions`);
                }
            }

            // Build the final query with native RRF fusion
            const queryRequest: any = {
                prefetch: prefetchQueries,
                query: {
                    fusion: "rrf" // Use Qdrant's native RRF implementation
                },
                limit: options?.limit || 10,
                with_payload: true
            };

            // Apply filters if specified
            if (options?.filterExpr) {
                queryRequest.filter = options.filterExpr;
            }

            console.log(`[QdrantDB] 🔍 Executing Query API with native RRF fusion...`);
            console.log(`[QdrantDB] 🔧 Query structure:`, JSON.stringify({
                prefetch_count: queryRequest.prefetch.length,
                fusion: queryRequest.query.fusion,
                limit: queryRequest.limit,
                has_filter: !!queryRequest.filter
            }, null, 2));

            // Execute the query using Qdrant's native Query API
            const queryResult = await this.client!.query(collectionName, queryRequest);
            const result = Array.isArray(queryResult) ? queryResult : queryResult.points || [];

            console.log(`[QdrantDB] ✅ Native hybrid search completed: ${result.length} results`);

            // Transform results to HybridSearchResult format
            const hybridResults: HybridSearchResult[] = result.map((point: ScoredPoint) => ({
                document: {
                    id: point.id.toString(),
                    vector: [], // Don't return vectors by default for performance
                    content: point.payload?.content as string,
                    relativePath: point.payload?.relativePath as string,
                    startLine: point.payload?.startLine as number,
                    endLine: point.payload?.endLine as number,
                    fileExtension: point.payload?.fileExtension as string,
                    metadata: this.extractMetadata(point.payload || {})
                },
                score: point.score || 0
            }));

            console.log(`[QdrantDB] 🎯 Final hybrid search results: ${hybridResults.length} documents`);
            
            return hybridResults;

        } catch (error) {
            console.error(`[QdrantDB] ❌ Failed to perform native hybrid search on collection '${collectionName}':`, error);
            throw error;
        }
    }


    async delete(collectionName: string, ids: string[]): Promise<void> {
        if (ids.length === 0) {
            return;
        }

        await this.ensureInitialized();

        try {
            // Use original IDs directly as they are already in the correct format from insert
            const validIds = ids;
            await this.client!.delete(collectionName, {
                points: validIds
            });
            console.log(`[QdrantDB] ✅ Deleted ${ids.length} documents from collection '${collectionName}'`);
        } catch (error) {
            console.error(`[QdrantDB] ❌ Failed to delete documents from collection '${collectionName}':`, error);
            throw error;
        }
    }

    async query(
        collectionName: string, 
        filter: any, 
        outputFields: string[], 
        limit?: number
    ): Promise<Record<string, any>[]> {
        await this.ensureInitialized();

        try {
            // filter should be a native Qdrant filter object (or empty)
            const builtFilter = filter || {};
            
            const scrollParams: any = {
                limit: limit || 100,
                with_payload: true,
                with_vector: false, // Don't return vectors for query operations
            };

            // Only add filter if it's not empty (Qdrant doesn't handle empty filters well)
            if (Object.keys(builtFilter).length > 0) {
                scrollParams.filter = builtFilter;
            }

            const result = await this.client!.scroll(collectionName, scrollParams) as ScrollResult;

            return result.points.map((point) => ({
                id: point.id,
                ...point.payload,
                // Create metadata field as JSON string for compatibility with sync logic
                metadata: JSON.stringify(point.payload || {})
            }));
        } catch (error) {
            console.error(`[QdrantDB] ❌ Failed to query collection '${collectionName}':`, error);
            throw error;
        }
    }

    async checkCollectionLimit(): Promise<boolean> {
        // Qdrant doesn't have collection limits like managed cloud services
        // Return true to indicate no limits
        return true;
    }

    /**
     * Build a Qdrant-specific filter for file extensions
     * @param extensions Array of file extensions (e.g., ['.ts', '.py'])
     * @returns Qdrant native filter object
     */
    buildExtensionFilter(extensions: string[]): any {
        if (!extensions || extensions.length === 0) {
            return {};
        }
        return {
            must: [{
                key: "fileExtension",
                match: { any: extensions }
            }]
        };
    }

    /**
     * Build a Qdrant-specific filter for exact path matching
     * @param relativePath Relative path to match exactly (e.g., 'src/utils.ts')
     * @returns Qdrant native filter object
     */
    buildPathFilter(relativePath: string): any {
        if (!relativePath) {
            return {};
        }
        return {
            must: [{
                key: "relativePath",
                match: { value: relativePath }
            }]
        };
    }

    /**
     * Extract metadata from payload, excluding known document fields
     */
    private extractMetadata(payload: any): Record<string, any> {
        const { content, relativePath, startLine, endLine, fileExtension, ...metadata } = payload;
        return metadata;
    }
}