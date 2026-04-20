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

    constructor(config: QdrantConfig) {
        this.config = config;
        const url = config.url || 'http://localhost:6333';
        console.log(`🔌 Connecting to Qdrant at: ${url}`);
        this.client = new QdrantClient({
            url,
            ...(config.apiKey && { apiKey: config.apiKey }),
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

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        if (documents.length === 0) return;

        const points = documents.map((doc) => ({
            id: doc.id,
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

        const points = documents.map((doc) => ({
            id: doc.id,
            vector: {
                dense: doc.vector,
            },
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
        // For hybrid search, use the dense vector request
        // Qdrant's fusion-based query API requires prefetch
        const limit = options?.limit || 10;
        const filter = options?.filterExpr ? this.parseFilterExpr(options.filterExpr) : undefined;

        // Find the dense vector request
        const denseRequest = searchRequests.find((r) => r.anns_field === 'vector');
        if (!denseRequest || !Array.isArray(denseRequest.data)) {
            // Fallback: use first request with array data
            const fallback = searchRequests.find((r) => Array.isArray(r.data));
            if (!fallback) {
                return [];
            }
            const results = await this.search(collectionName, fallback.data as number[], {
                topK: limit,
                ...(options?.filterExpr && { filterExpr: options.filterExpr }),
            });
            return results;
        }

        const results = await this.client.search(collectionName, {
            vector: {
                name: 'dense',
                vector: denseRequest.data as number[],
            },
            limit,
            with_payload: true,
            ...(filter && { filter }),
        });

        return results.map((result) => ({
            document: this.pointToDocument(result),
            score: result.score,
        }));
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        if (ids.length === 0) return;

        await this.client.delete(collectionName, {
            wait: true,
            points: ids,
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
