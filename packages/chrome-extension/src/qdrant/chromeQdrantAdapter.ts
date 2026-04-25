/**
 * Chrome Extension adapter for Qdrant Vector Database.
 * Mirrors the public API of ChromeMilvusAdapter so background.ts can swap
 * implementations via the VECTORDB_PROVIDER setting.
 *
 * Implementation talks to Qdrant's REST API directly with `fetch` — no SDK
 * dependency, runs in any Manifest V3 service worker.
 */

import { QdrantConfig, QdrantConfigManager } from '../config/qdrantConfig';

export interface CodeChunk {
    id: string;
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    fileExtension: string;
    metadata: string;
    vector?: number[];
}

export interface SearchResult {
    id: string;
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    fileExtension: string;
    metadata: string;
    score: number;
}

interface QdrantPoint {
    id: string;
    vector: number[];
    payload: {
        content: string;
        relativePath: string;
        startLine: number;
        endLine: number;
        fileExtension: string;
        metadata: Record<string, any>;
    };
}

interface QdrantSearchHit {
    id: string;
    score: number;
    payload: QdrantPoint['payload'];
}

export class ChromeQdrantAdapter {
    private config: QdrantConfig | null = null;
    private collectionName: string;

    constructor(collectionName: string = 'chrome_code_chunks') {
        this.collectionName = collectionName;
    }

    /** Initialize from chrome.storage.sync */
    async initialize(): Promise<void> {
        const config = await QdrantConfigManager.getQdrantConfig();
        if (!QdrantConfigManager.validateQdrantConfig(config)) {
            throw new Error('Invalid or missing Qdrant configuration');
        }
        this.config = config;
        console.log('🔌 Chrome Qdrant adapter initialized');
    }

    /**
     * Create the collection with the given vector dimension.
     * Uses cosine distance, on_disk=false (browser-side requests are infrequent enough).
     */
    async createCollection(dimension: number = 1536): Promise<void> {
        await this.fetch(`/collections/${encodeURIComponent(this.collectionName)}`, {
            method: 'PUT',
            body: JSON.stringify({
                vectors: { size: dimension, distance: 'Cosine' },
            }),
        });
        console.log(`✅ Collection '${this.collectionName}' created successfully`);
    }

    /** Check if collection exists. */
    async collectionExists(): Promise<boolean> {
        try {
            const res = await this.fetch(`/collections/${encodeURIComponent(this.collectionName)}/exists`, {
                method: 'GET',
            });
            return res?.result?.exists === true;
        } catch (error) {
            console.error('Error checking collection existence:', error);
            return false;
        }
    }

    /**
     * Insert (upsert) chunks. Qdrant requires UUID or integer IDs — we convert
     * the (likely MD5/hex) string IDs to deterministic UUID format so the same
     * input always produces the same point ID (idempotent re-indexing).
     */
    async insertChunks(chunks: CodeChunk[]): Promise<void> {
        if (chunks.length === 0) return;

        const points: QdrantPoint[] = chunks.map((chunk) => ({
            id: this.toUuid(chunk.id),
            vector: chunk.vector || [],
            payload: {
                content: chunk.content,
                relativePath: chunk.relativePath,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                fileExtension: chunk.fileExtension,
                metadata: this.parseMetadata(chunk.metadata),
            },
        }));

        await this.fetch(`/collections/${encodeURIComponent(this.collectionName)}/points?wait=true`, {
            method: 'PUT',
            body: JSON.stringify({ points }),
        });
        console.log(`✅ Inserted ${points.length} chunks into Qdrant`);
    }

    /** Search top-K most similar chunks. Threshold maps to Qdrant `score_threshold`. */
    async searchSimilar(queryVector: number[], limit: number = 10, threshold: number = 0.3): Promise<SearchResult[]> {
        const res = await this.fetch(`/collections/${encodeURIComponent(this.collectionName)}/points/search`, {
            method: 'POST',
            body: JSON.stringify({
                vector: queryVector,
                limit,
                score_threshold: threshold,
                with_payload: true,
            }),
        });

        const hits: QdrantSearchHit[] = res?.result || [];
        const searchResults: SearchResult[] = hits.map((hit) => ({
            id: hit.id,
            content: hit.payload?.content ?? '',
            relativePath: hit.payload?.relativePath ?? '',
            startLine: hit.payload?.startLine ?? 0,
            endLine: hit.payload?.endLine ?? 0,
            fileExtension: hit.payload?.fileExtension ?? '',
            metadata: JSON.stringify(hit.payload?.metadata ?? {}),
            score: hit.score,
        }));

        searchResults.sort((a, b) => b.score - a.score);
        console.log(
            `🔍 Found ${searchResults.length} results with cosine similarity scores:`,
            searchResults.slice(0, 5).map((r) => ({
                path: r.relativePath.split('/').pop(),
                score: r.score.toFixed(4),
                lines: `${r.startLine}-${r.endLine}`,
            }))
        );
        return searchResults;
    }

    /** Drop collection (clears all data). */
    async clearCollection(): Promise<void> {
        await this.fetch(`/collections/${encodeURIComponent(this.collectionName)}`, {
            method: 'DELETE',
        });
        console.log(`✅ Collection '${this.collectionName}' cleared successfully`);
    }

    /** Get vector count for the collection. */
    async getCollectionStats(): Promise<{ totalEntities: number } | null> {
        try {
            const res = await this.fetch(`/collections/${encodeURIComponent(this.collectionName)}`, {
                method: 'GET',
            });
            return { totalEntities: res?.result?.points_count ?? 0 };
        } catch (error) {
            console.error('❌ Failed to get collection stats:', error);
            return null;
        }
    }

    /** Lightweight reachability + auth test. */
    async testConnection(): Promise<boolean> {
        const config = await QdrantConfigManager.getQdrantConfig();
        if (!QdrantConfigManager.validateQdrantConfig(config)) {
            throw new Error('Invalid or missing Qdrant configuration');
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.apiKey) headers['api-key'] = config.apiKey;

        const res = await fetch(`${config.url.replace(/\/$/, '')}/collections`, {
            method: 'GET',
            headers,
        });
        if (!res.ok) {
            throw new Error(`Qdrant connection test failed: ${res.status} ${res.statusText}`);
        }
        console.log('Qdrant connection test successful');
        return true;
    }

    // ---------- internals ----------

    /**
     * Convert any string ID (commonly MD5 hex) to UUID format so Qdrant accepts it.
     * For 32-char hex strings this is a direct hyphen insertion. For other inputs we
     * fall back to a SHA-derived UUID using SubtleCrypto (browser-native).
     */
    private toUuid(id: string): string {
        if (/^[0-9a-fA-F]{32}$/.test(id)) {
            return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
        }
        // Already UUID? pass through.
        if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
            return id;
        }
        // Fallback: hash the string into 32 hex chars and format as UUID.
        let hash = 0x811c9dc5;
        for (let i = 0; i < id.length; i++) {
            hash ^= id.charCodeAt(i);
            hash = (hash * 0x01000193) >>> 0;
        }
        const hex = hash.toString(16).padStart(8, '0').repeat(4).slice(0, 32);
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    private parseMetadata(metadata: string): Record<string, any> {
        if (!metadata) return {};
        try {
            return JSON.parse(metadata);
        } catch {
            return {};
        }
    }

    private async fetch(path: string, init: RequestInit): Promise<any> {
        if (!this.config) {
            throw new Error('Qdrant not initialized');
        }
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...((init.headers as Record<string, string>) || {}),
        };
        if (this.config.apiKey) {
            headers['api-key'] = this.config.apiKey;
        }

        const url = `${this.config.url.replace(/\/$/, '')}${path}`;
        const res = await fetch(url, { ...init, headers });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Qdrant ${init.method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
        }
        // Some Qdrant responses (DELETE) return JSON; some return empty.
        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }
}
