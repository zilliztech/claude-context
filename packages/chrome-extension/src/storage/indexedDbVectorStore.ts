/**
 * Local-only vector store backed by IndexedDB.
 *
 * Why this exists:
 *   - The Chrome Extension currently relies on a remote vector DB (Milvus, soon
 *     Qdrant via PR #4). For users who want offline / single-machine use, that
 *     is overkill — we can store vectors directly in the browser.
 *   - chrome.storage.sync caps at ~10MB (insufficient for embeddings).
 *     IndexedDB is uncapped (subject to per-origin quota, typically GBs).
 *
 * Implementation:
 *   - One IndexedDB database per extension install (`claude-context-store`).
 *   - One object store per Qdrant/Milvus "collection" (i.e. per repo).
 *   - Search is a linear scan + cosine similarity in JS. Fine for repos up to
 *     ~50k chunks; beyond that, users should run a real vector DB.
 *
 * Public API mirrors the shape of ChromeMilvusAdapter / ChromeQdrantAdapter so
 * a future commit can register it via the same `createVectorDBAdapter` factory.
 */

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

interface StoredPoint {
    id: string;
    vector: number[];
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    fileExtension: string;
    metadata: string;
}

const DB_NAME = 'claude-context-store';
const DB_VERSION = 1;

export class IndexedDbVectorStore {
    private db: IDBDatabase | null = null;
    private collectionName: string;
    private knownCollections: Set<string> = new Set();

    constructor(collectionName: string = 'chrome_code_chunks') {
        this.collectionName = this.sanitize(collectionName);
    }

    /** Open (or create) the IndexedDB database. */
    async initialize(): Promise<void> {
        this.db = await openDb();
        // Track collections that already exist so collectionExists() is sync after init.
        for (const name of Array.from(this.db.objectStoreNames)) {
            this.knownCollections.add(name);
        }
        console.log('🗄️ IndexedDB vector store initialized');
    }

    /**
     * Object stores can only be created/dropped during a versionchange transaction,
     * so this triggers a DB version bump.
     */
    async createCollection(_dimension: number = 1536): Promise<void> {
        if (!this.db) throw new Error('Store not initialized');
        if (this.knownCollections.has(this.collectionName)) return;

        const oldVersion = this.db.version;
        this.db.close();
        this.db = await openDb(oldVersion + 1, (db) => {
            if (!db.objectStoreNames.contains(this.collectionName)) {
                db.createObjectStore(this.collectionName, { keyPath: 'id' });
            }
        });
        this.knownCollections.add(this.collectionName);
        console.log(`✅ IndexedDB collection '${this.collectionName}' created`);
    }

    async collectionExists(): Promise<boolean> {
        if (!this.db) return false;
        return this.db.objectStoreNames.contains(this.collectionName);
    }

    async insertChunks(chunks: CodeChunk[]): Promise<void> {
        if (!this.db) throw new Error('Store not initialized');
        if (chunks.length === 0) return;

        const tx = this.db.transaction(this.collectionName, 'readwrite');
        const store = tx.objectStore(this.collectionName);

        for (const chunk of chunks) {
            const point: StoredPoint = {
                id: chunk.id,
                vector: chunk.vector ?? [],
                content: chunk.content,
                relativePath: chunk.relativePath,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                fileExtension: chunk.fileExtension,
                metadata: chunk.metadata,
            };
            store.put(point);
        }

        await txDone(tx);
        console.log(`✅ Inserted ${chunks.length} chunks into IndexedDB`);
    }

    async searchSimilar(queryVector: number[], limit: number = 10, threshold: number = 0.3): Promise<SearchResult[]> {
        if (!this.db) throw new Error('Store not initialized');

        const tx = this.db.transaction(this.collectionName, 'readonly');
        const store = tx.objectStore(this.collectionName);
        const all: StoredPoint[] = await new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result as StoredPoint[]);
            req.onerror = () => reject(req.error);
        });

        const scored: SearchResult[] = [];
        for (const point of all) {
            const score = cosine(queryVector, point.vector);
            if (score < threshold) continue;
            scored.push({
                id: point.id,
                content: point.content,
                relativePath: point.relativePath,
                startLine: point.startLine,
                endLine: point.endLine,
                fileExtension: point.fileExtension,
                metadata: point.metadata,
                score,
            });
        }

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit);
    }

    async clearCollection(): Promise<void> {
        if (!this.db) throw new Error('Store not initialized');
        if (!this.db.objectStoreNames.contains(this.collectionName)) return;

        const oldVersion = this.db.version;
        this.db.close();
        this.db = await openDb(oldVersion + 1, (db) => {
            if (db.objectStoreNames.contains(this.collectionName)) {
                db.deleteObjectStore(this.collectionName);
            }
        });
        this.knownCollections.delete(this.collectionName);
        console.log(`✅ IndexedDB collection '${this.collectionName}' cleared`);
    }

    async getCollectionStats(): Promise<{ totalEntities: number } | null> {
        if (!this.db) return null;
        if (!this.db.objectStoreNames.contains(this.collectionName)) return null;

        const tx = this.db.transaction(this.collectionName, 'readonly');
        const store = tx.objectStore(this.collectionName);
        const count: number = await new Promise((resolve, reject) => {
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return { totalEntities: count };
    }

    /** IndexedDB has no remote dependency, so connection always succeeds when API exists. */
    async testConnection(): Promise<boolean> {
        if (typeof indexedDB === 'undefined') {
            throw new Error('IndexedDB API not available in this context');
        }
        return true;
    }

    /** IndexedDB object store names allow more chars than Milvus/Qdrant; sanitize for cross-store consistency. */
    private sanitize(name: string): string {
        return name.replace(/[^a-zA-Z0-9_]/g, '_');
    }
}

// ---------- IndexedDB plumbing ----------

function openDb(version?: number, onUpgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, version ?? DB_VERSION);
        req.onupgradeneeded = () => onUpgrade?.(req.result);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB open blocked by another connection'));
    });
}

function txDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

function cosine(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
