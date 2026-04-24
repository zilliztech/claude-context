import { QdrantClient } from '@qdrant/js-client-rest';
import {
    VectorDatabase,
    VectorDocument,
    SearchOptions,
    VectorSearchResult,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult,
} from './types';

export interface QdrantConfig {
    url?: string;
    apiKey?: string;
}

export class QdrantVectorDatabase implements VectorDatabase {
    private config: QdrantConfig;
    private client: QdrantClient;

    /**
     * Tokenize text into words for BM25 sparse vector generation.
     * Simple but effective: lowercase, split on non-alphanumeric, remove short tokens.
     */
    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .split(/[^a-z0-9_]+/)
            .filter((t) => t.length > 1);
    }

    /**
     * Simple hash function to map tokens to sparse vector indices.
     * Uses FNV-1a for fast, low-collision hashing.
     */
    private hashToken(token: string): number {
        let hash = 0x811c9dc5;
        for (let i = 0; i < token.length; i++) {
            hash ^= token.charCodeAt(i);
            hash = (hash * 0x01000193) >>> 0;
        }
        // Keep indices in reasonable range (0 to 2^30)
        return hash & 0x3fffffff;
    }

    /**
     * Compute TF-based sparse vector from text for BM25-like matching.
     * Uses term frequency with sublinear scaling: 1 + log(tf).
     */
    private computeSparseVector(text: string): { indices: number[]; values: number[] } {
        const tokens = this.tokenize(text);
        const tf = new Map<number, number>();

        for (const token of tokens) {
            const idx = this.hashToken(token);
            tf.set(idx, (tf.get(idx) || 0) + 1);
        }

        const indices: number[] = [];
        const values: number[] = [];

        for (const [idx, count] of tf.entries()) {
            indices.push(idx);
            // Sublinear TF scaling: 1 + log(tf) to dampen high-frequency terms
            values.push(1 + Math.log(count));
        }

        return { indices, values };
    }

    constructor(config: QdrantConfig) {
        this.config = config;
        const url = config.url || 'http://localhost:6333';
        console.log(`🔌 Connecting to Qdrant at: ${url}`);

        // Auto-detect port for HTTPS URLs without explicit port
        const parsedUrl = new URL(url);
        const needsPort = parsedUrl.protocol === 'https:' && !config.url?.match(/:\d+$/);

        this.client = new QdrantClient({
            url,
            ...(needsPort && { port: 443 }),
            ...(config.apiKey && { apiKey: config.apiKey }),
            checkCompatibility: false,
        });
    }

    async createCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        const exists = await this.hasCollection(collectionName);
        if (exists) {
            console.log(`[Qdrant] Collection '${collectionName}' already exists, skipping creation`);
            return;
        }

        await this.client.createCollection(collectionName, {
            vectors: {
                size: dimension,
                distance: 'Cosine',
            },
        });
        console.log(`[Qdrant] ✅ Collection '${collectionName}' created (dimension: ${dimension})`);

        // Create payload indexes for common filter fields
        await this.createPayloadIndexes(collectionName);
    }

    async createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        const exists = await this.hasCollection(collectionName);
        if (exists) {
            console.log(`[Qdrant] Collection '${collectionName}' already exists, skipping creation`);
            return;
        }

        await this.client.createCollection(collectionName, {
            vectors: {
                dense: {
                    size: dimension,
                    distance: 'Cosine',
                },
            },
            sparse_vectors: {
                sparse: {},
            },
        });
        console.log(`[Qdrant] ✅ Hybrid collection '${collectionName}' created (dimension: ${dimension})`);

        await this.createPayloadIndexes(collectionName);
    }

    private async createPayloadIndexes(collectionName: string): Promise<void> {
        try {
            await this.client.createPayloadIndex(collectionName, {
                field_name: 'relativePath',
                field_schema: 'keyword',
                wait: true,
            });
            await this.client.createPayloadIndex(collectionName, {
                field_name: 'fileExtension',
                field_schema: 'keyword',
                wait: true,
            });
        } catch (error) {
            console.warn(`[Qdrant] ⚠️ Could not create payload indexes: ${error}`);
        }
    }

    async dropCollection(collectionName: string): Promise<void> {
        const exists = await this.hasCollection(collectionName);
        if (!exists) {
            return;
        }
        await this.client.deleteCollection(collectionName);
        console.log(`[Qdrant] 🗑️ Collection '${collectionName}' dropped`);
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        try {
            const result = await this.client.collectionExists(collectionName);
            return result.exists;
        } catch {
            return false;
        }
    }

    async listCollections(): Promise<string[]> {
        const result = await this.client.getCollections();
        return result.collections.map((c) => c.name);
    }

    /**
     * Convert a string ID to UUID format for Qdrant.
     */
    private toUUID(id: string): string {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            return id;
        }
        // If 32-char hex (MD5), format as UUID
        if (/^[0-9a-f]{32}$/i.test(id)) {
            return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
        }
        // Otherwise hash to MD5 and format
        const hash = require('crypto').createHash('md5').update(id).digest('hex');
        return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        if (documents.length === 0) return;

        const points = documents.map((doc) => ({
            id: this.toUUID(doc.id),
            vector: doc.vector,
            payload: {
                content: doc.content,
                relativePath: doc.relativePath,
                startLine: doc.startLine,
                endLine: doc.endLine,
                fileExtension: doc.fileExtension,
                ...doc.metadata,
            },
        }));

        await this.client.upsert(collectionName, {
            wait: true,
            points,
        });
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        if (documents.length === 0) return;

        const points = documents.map((doc) => {
            const sparse = this.computeSparseVector(doc.content);
            return {
                id: this.toUUID(doc.id),
                vector: {
                    dense: doc.vector,
                    sparse: sparse,
                },
                payload: {
                    content: doc.content,
                    relativePath: doc.relativePath,
                    startLine: doc.startLine,
                    endLine: doc.endLine,
                    fileExtension: doc.fileExtension,
                    ...doc.metadata,
                },
            };
        });

        await this.client.upsert(collectionName, {
            wait: true,
            points,
        });
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        const limit = options?.topK || 10;
        const filter = options?.filterExpr ? this.parseFilterExpr(options.filterExpr) : undefined;

        const results = await this.client.search(collectionName, {
            vector: queryVector,
            limit,
            with_payload: true,
            ...(filter && { filter }),
        });

        return results.map((result) => ({
            document: this.pointToDocument(result),
            score: result.score,
        }));
    }

    async hybridSearch(
        collectionName: string,
        searchRequests: HybridSearchRequest[],
        options?: HybridSearchOptions
    ): Promise<HybridSearchResult[]> {
        const limit = options?.limit || 10;
        const filter = options?.filterExpr ? this.parseFilterExpr(options.filterExpr) : undefined;

        // Find dense vector and text query from search requests
        const denseRequest = searchRequests.find((r) => r.anns_field === 'vector');
        const sparseRequest = searchRequests.find((r) => r.anns_field === 'sparse_vector');

        if (!denseRequest || !Array.isArray(denseRequest.data)) {
            const fallback = searchRequests.find((r) => Array.isArray(r.data));
            if (!fallback) return [];
            return this.search(collectionName, fallback.data as number[], {
                topK: limit,
                ...(options?.filterExpr && { filterExpr: options.filterExpr }),
            });
        }

        // Build sparse query vector from text if available
        const queryText = sparseRequest && typeof sparseRequest.data === 'string'
            ? sparseRequest.data
            : null;

        if (!queryText) {
            // No text for sparse search — fall back to dense-only
            const results = await this.client.search(collectionName, {
                vector: { name: 'dense', vector: denseRequest.data as number[] },
                limit,
                with_payload: true,
                ...(filter && { filter }),
            });
            return results.map((r) => ({ document: this.pointToDocument(r), score: r.score }));
        }

        // Compute sparse vector from query text for BM25-like matching
        const sparseVector = this.computeSparseVector(queryText);

        // Hybrid search with RRF fusion: prefetch dense + sparse, fuse results
        // Qdrant query API uses 'using' field for named vectors, not nested {name, vector}
        const results = await this.client.query(collectionName, {
            prefetch: [
                {
                    query: denseRequest.data as number[],
                    using: 'dense',
                    limit: limit * 3,
                    ...(filter && { filter }),
                },
                {
                    query: sparseVector as any,
                    using: 'sparse',
                    limit: limit * 3,
                    ...(filter && { filter }),
                },
            ],
            query: { fusion: 'rrf' } as any,
            limit,
            with_payload: true,
        });

        return results.points.map((point) => ({
            document: this.pointToDocument(point),
            score: point.score || 0,
        }));
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        if (ids.length === 0) return;

        await this.client.delete(collectionName, {
            wait: true,
            points: ids.map((id) => this.toUUID(id)),
        });
    }

    async query(
        collectionName: string,
        filter: string,
        outputFields: string[],
        limit?: number
    ): Promise<Record<string, any>[]> {
        const qdrantFilter = filter ? this.parseFilterExpr(filter) : undefined;

        const result = await this.client.scroll(collectionName, {
            filter: qdrantFilter,
            limit: limit || 100,
            with_payload: true,
            with_vector: false,
        });

        return result.points.map((point) => {
            const record: Record<string, any> = { id: point.id };
            if (point.payload) {
                for (const field of outputFields) {
                    if (field in (point.payload as Record<string, any>)) {
                        record[field] = (point.payload as Record<string, any>)[field];
                    }
                }
            }
            return record;
        });
    }

    async getCollectionDescription(collectionName: string): Promise<string> {
        try {
            const info = await this.client.getCollection(collectionName);
            return `Qdrant collection: ${collectionName}, points: ${info.points_count}`;
        } catch {
            return '';
        }
    }

    async checkCollectionLimit(): Promise<boolean> {
        // Qdrant doesn't have collection limits like Zilliz Cloud
        return true;
    }

    async getCollectionRowCount(collectionName: string): Promise<number> {
        try {
            const result = await this.client.count(collectionName, { exact: true });
            return result.count;
        } catch {
            return -1;
        }
    }

    /**
     * Parse Milvus-style filter expression to Qdrant filter format.
     * Supports: relativePath == "value" style expressions.
     */
    private parseFilterExpr(expr: string): Record<string, any> | undefined {
        if (!expr || expr.trim() === '') return undefined;

        // Match: field == "value"
        const eqMatch = expr.match(/^(\w+)\s*==\s*"([^"]*)"$/);
        if (eqMatch) {
            return {
                must: [
                    {
                        key: eqMatch[1],
                        match: { value: eqMatch[2] },
                    },
                ],
            };
        }

        // Match: field in ["val1", "val2"]
        const inMatch = expr.match(/^(\w+)\s+in\s+\[(.+)\]$/);
        if (inMatch) {
            const values = inMatch[2].match(/"([^"]*)"/g)?.map((v) => v.replace(/"/g, '')) || [];
            return {
                should: values.map((value) => ({
                    key: inMatch[1],
                    match: { value },
                })),
            };
        }

        console.warn(`[Qdrant] ⚠️ Could not parse filter expression: ${expr}`);
        return undefined;
    }

    private pointToDocument(point: Record<string, any>): VectorDocument {
        const payload = (point.payload || {}) as Record<string, any>;
        return {
            id: String(point.id),
            vector: point.vector || [],
            content: payload.content || '',
            relativePath: payload.relativePath || '',
            startLine: payload.startLine || 0,
            endLine: payload.endLine || 0,
            fileExtension: payload.fileExtension || '',
            metadata: Object.fromEntries(
                Object.entries(payload).filter(
                    ([key]) => !['content', 'relativePath', 'startLine', 'endLine', 'fileExtension'].includes(key)
                )
            ),
        };
    }
}
