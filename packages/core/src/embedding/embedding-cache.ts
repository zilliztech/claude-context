import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { EmbeddingVector } from './base-embedding';
import { envManager } from '../utils/env-manager';

export interface CacheSetItem {
    content: string;
    embedding: EmbeddingVector;
}

export interface CacheGetBatchResult {
    results: (EmbeddingVector | null)[];
    uncachedIndices: number[];
}

/**
 * Backend contract for the embedding cache. Lookups are content-addressed
 * (`sha256(model + "\n" + content)`), so identical chunks across branches/repos hit once.
 */
interface CacheBackend {
    isEnabled(): boolean;
    getBatch(contents: string[]): Promise<CacheGetBatchResult>;
    setBatch(items: CacheSetItem[]): Promise<void>;
    cleanup(maxAgeDays?: number): Promise<void>;
}

function keyFor(model: string, content: string): string {
    return crypto.createHash('sha256').update(`${model}\n${content}`).digest('hex');
}

/**
 * Pluggable embedding cache. Backend selected by `EMBEDDING_CACHE_BACKEND`:
 *   - `disk` (default): per-machine JSON files under ~/.context/embedding-cache (legacy behavior).
 *   - `postgres`: shared, durable, content-addressed table (`EMBEDDING_CACHE_URL`). Dedups embeds
 *     across branches AND repos so a new branch reuses an existing branch's vectors — only the diff
 *     hits the embedding API. This is exact-key lookup only; all ANN/similarity lives in the vector DB.
 *
 * Disabled entirely when `EMBEDDING_CACHE=false`.
 */
export class EmbeddingCache {
    private backend: CacheBackend;

    constructor(model: string, cacheDir?: string) {
        const globallyEnabled = (envManager.get('EMBEDDING_CACHE') || 'true').toLowerCase() !== 'false';
        const backendName = (envManager.get('EMBEDDING_CACHE_BACKEND') || 'disk').toLowerCase();

        if (!globallyEnabled) {
            this.backend = new DisabledCacheBackend();
        } else if (backendName === 'postgres' || backendName === 'pg') {
            this.backend = new PostgresCacheBackend(model);
        } else {
            this.backend = new DiskCacheBackend(model, cacheDir);
        }
    }

    isEnabled(): boolean {
        return this.backend.isEnabled();
    }

    async getBatch(contents: string[]): Promise<CacheGetBatchResult> {
        if (!this.backend.isEnabled()) {
            return { results: new Array(contents.length).fill(null), uncachedIndices: contents.map((_, i) => i) };
        }
        return this.backend.getBatch(contents);
    }

    async setBatch(items: CacheSetItem[]): Promise<void> {
        if (!this.backend.isEnabled() || items.length === 0) return;
        await this.backend.setBatch(items);
    }

    async cleanup(maxAgeDays?: number): Promise<void> {
        if (!this.backend.isEnabled()) return;
        await this.backend.cleanup(maxAgeDays);
    }
}

class DisabledCacheBackend implements CacheBackend {
    isEnabled(): boolean { return false; }
    async getBatch(contents: string[]): Promise<CacheGetBatchResult> {
        return { results: new Array(contents.length).fill(null), uncachedIndices: contents.map((_, i) => i) };
    }
    async setBatch(): Promise<void> { /* no-op */ }
    async cleanup(): Promise<void> { /* no-op */ }
}

/**
 * Legacy per-machine disk cache: one JSON file per content hash under a model-namespaced dir.
 * Behavior unchanged from the original EmbeddingCache.
 */
class DiskCacheBackend implements CacheBackend {
    private cacheDir: string;
    private enabled: boolean;
    private model: string;

    constructor(model: string, cacheDir?: string) {
        this.model = model;
        this.enabled = true;

        const baseDir = cacheDir
            || envManager.get('EMBEDDING_CACHE_DIR')
            || path.join(os.homedir(), '.context', 'embedding-cache');

        const safeModel = model.replace(/[^a-zA-Z0-9_-]/g, '_');
        this.cacheDir = path.join(baseDir, safeModel);

        try {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        } catch {
            console.warn(`[Cache] ⚠️ Could not create cache dir: ${this.cacheDir}`);
            this.enabled = false;
        }
    }

    isEnabled(): boolean { return this.enabled; }

    private getCachePath(contentHash: string): string {
        const prefix = contentHash.slice(0, 2);
        return path.join(this.cacheDir, prefix, contentHash.slice(0, 12) + '.json');
    }

    private get(content: string): EmbeddingVector | null {
        try {
            const cachePath = this.getCachePath(keyFor(this.model, content));
            if (!fs.existsSync(cachePath)) return null;
            const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
            return { vector: data.v, dimension: data.d };
        } catch {
            return null;
        }
    }

    private set(content: string, embedding: EmbeddingVector): void {
        try {
            const cachePath = this.getCachePath(keyFor(this.model, content));
            fs.mkdirSync(path.dirname(cachePath), { recursive: true });
            fs.writeFileSync(cachePath, JSON.stringify({ v: embedding.vector, d: embedding.dimension }));
        } catch {
            // best-effort
        }
    }

    async getBatch(contents: string[]): Promise<CacheGetBatchResult> {
        const results: (EmbeddingVector | null)[] = new Array(contents.length).fill(null);
        const uncachedIndices: number[] = [];
        for (let i = 0; i < contents.length; i++) {
            const cached = this.get(contents[i]);
            if (cached) results[i] = cached;
            else uncachedIndices.push(i);
        }
        return { results, uncachedIndices };
    }

    async setBatch(items: CacheSetItem[]): Promise<void> {
        for (const item of items) this.set(item.content, item.embedding);
    }

    async cleanup(maxAgeDays?: number): Promise<void> {
        const days = maxAgeDays ?? parseInt(envManager.get('EMBEDDING_CACHE_MAX_AGE_DAYS') || '30', 10);
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        let deleted = 0;
        try {
            const prefixDirs = fs.readdirSync(this.cacheDir);
            for (const prefix of prefixDirs) {
                const prefixPath = path.join(this.cacheDir, prefix);
                if (!fs.statSync(prefixPath).isDirectory()) continue;
                for (const file of fs.readdirSync(prefixPath)) {
                    const filePath = path.join(prefixPath, file);
                    if (fs.statSync(filePath).mtimeMs < cutoff) {
                        fs.unlinkSync(filePath);
                        deleted++;
                    }
                }
                if (fs.readdirSync(prefixPath).length === 0) fs.rmdirSync(prefixPath);
            }
            if (deleted > 0) console.log(`[Cache] 🧹 Cleaned up ${deleted} stale cache files (>${days} days old)`);
        } catch {
            // best-effort
        }
    }
}

/**
 * Shared Postgres cache. Plain psql (no pgvector) — exact-key lookup only. Vectors are stored as
 * packed float32 BYTEA (~dim*4 bytes/row). `pg` is imported lazily so disk users don't need it.
 */
class PostgresCacheBackend implements CacheBackend {
    private model: string;
    private dsn: string | undefined;
    private enabled: boolean;
    private pool: any = null;
    private initPromise: Promise<void> | null = null;

    constructor(model: string) {
        this.model = model;
        this.dsn = envManager.get('EMBEDDING_CACHE_URL') || envManager.get('DATABASE_URL') || undefined;
        this.enabled = !!this.dsn;
        if (!this.enabled) {
            console.warn('[Cache] ⚠️ EMBEDDING_CACHE_BACKEND=postgres but EMBEDDING_CACHE_URL is unset — cache disabled');
        }
    }

    isEnabled(): boolean { return this.enabled; }

    private async ensureReady(): Promise<void> {
        if (!this.enabled) return;
        if (this.initPromise) return this.initPromise;
        this.initPromise = (async () => {
            try {
                // @ts-ignore - optional dependency, only required when EMBEDDING_CACHE_BACKEND=postgres
                const pg: any = await import('pg');
                const Pool = pg.Pool || (pg.default && pg.default.Pool);
                this.pool = new Pool({ connectionString: this.dsn, max: 4 });
                await this.pool.query(`
                    CREATE TABLE IF NOT EXISTS embedding_cache (
                        key        TEXT PRIMARY KEY,
                        model      TEXT NOT NULL,
                        dim        INT  NOT NULL,
                        vec        BYTEA NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );
                `);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[Cache] ⚠️ Postgres cache unavailable (${msg}) — falling back to no cache`);
                this.enabled = false;
                if (this.pool) { try { await this.pool.end(); } catch { /* ignore */ } this.pool = null; }
            }
        })();
        return this.initPromise;
    }

    private static pack(vector: number[]): Buffer {
        return Buffer.from(new Float32Array(vector).buffer);
    }

    private static unpack(buf: Buffer): number[] {
        const f32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
        return Array.from(f32);
    }

    async getBatch(contents: string[]): Promise<CacheGetBatchResult> {
        const results: (EmbeddingVector | null)[] = new Array(contents.length).fill(null);
        const uncachedIndices: number[] = [];

        await this.ensureReady();
        if (!this.enabled || !this.pool) {
            return { results, uncachedIndices: contents.map((_, i) => i) };
        }

        const keys = contents.map(c => keyFor(this.model, c));
        const keyToIndex = new Map<string, number>();
        keys.forEach((k, i) => { if (!keyToIndex.has(k)) keyToIndex.set(k, i); });

        try {
            const res = await this.pool.query(
                'SELECT key, dim, vec FROM embedding_cache WHERE key = ANY($1::text[])',
                [Array.from(new Set(keys))]
            );
            const found = new Map<string, EmbeddingVector>();
            for (const row of res.rows) {
                found.set(row.key, { vector: PostgresCacheBackend.unpack(row.vec), dimension: row.dim });
            }
            for (let i = 0; i < contents.length; i++) {
                const hit = found.get(keys[i]);
                if (hit) results[i] = hit;
                else uncachedIndices.push(i);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Cache] ⚠️ Postgres getBatch failed (${msg}) — treating as all-miss`);
            return { results: new Array(contents.length).fill(null), uncachedIndices: contents.map((_, i) => i) };
        }

        return { results, uncachedIndices };
    }

    async setBatch(items: CacheSetItem[]): Promise<void> {
        await this.ensureReady();
        if (!this.enabled || !this.pool || items.length === 0) return;

        // Dedup by key, then insert in chunks to stay under the parameter limit.
        const rows = new Map<string, { dim: number; vec: Buffer }>();
        for (const { content, embedding } of items) {
            rows.set(keyFor(this.model, content), {
                dim: embedding.dimension,
                vec: PostgresCacheBackend.pack(embedding.vector),
            });
        }

        const entries = Array.from(rows.entries());
        const CHUNK = 500;
        try {
            for (let start = 0; start < entries.length; start += CHUNK) {
                const slice = entries.slice(start, start + CHUNK);
                const values: string[] = [];
                const params: any[] = [];
                slice.forEach(([key, { dim, vec }], i) => {
                    const b = i * 4;
                    values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
                    params.push(key, this.model, dim, vec);
                });
                await this.pool.query(
                    `INSERT INTO embedding_cache (key, model, dim, vec) VALUES ${values.join(', ')}
                     ON CONFLICT (key) DO NOTHING`,
                    params
                );
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Cache] ⚠️ Postgres setBatch failed (${msg}) — skipping cache write`);
        }
    }

    async cleanup(): Promise<void> {
        // Durable shared cache: no TTL eviction. Savings compound over time.
    }
}
