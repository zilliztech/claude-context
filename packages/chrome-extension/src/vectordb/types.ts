/**
 * Provider-agnostic adapter interface used by background.ts.
 * Both ChromeMilvusAdapter and ChromeQdrantAdapter implement this shape so the
 * background script can swap implementations based on the user's configured
 * VECTORDB_PROVIDER (default: milvus).
 */

import type { CodeChunk, SearchResult } from '../milvus/chromeMilvusAdapter';

export type VectorDBProvider = 'milvus' | 'qdrant';

export interface VectorDBAdapter {
    initialize(): Promise<void>;
    createCollection(dimension?: number): Promise<void>;
    collectionExists(): Promise<boolean>;
    insertChunks(chunks: CodeChunk[]): Promise<void>;
    searchSimilar(queryVector: number[], limit?: number, threshold?: number): Promise<SearchResult[]>;
    clearCollection(): Promise<void>;
    getCollectionStats(): Promise<{ totalEntities: number } | null>;
    testConnection(): Promise<boolean>;
}

export const VECTORDB_PROVIDER_STORAGE_KEY = 'vectordbProvider';
