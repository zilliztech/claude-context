import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/**
 * A content-addressed cache mapping (model, text) -> embedding vector.
 *
 * Embeddings are a pure function of the model and the input text, so an
 * identical chunk of code produces an identical vector every time it is
 * embedded. Across many collections indexed on the same machine - for
 * example the same repository checked out into several git worktrees, each
 * on a different branch - the overwhelming majority of chunks are byte-for-byte
 * identical. Without a cache each collection re-embeds all of them from
 * scratch, which on a CPU embedder dominates indexing time. This cache lets
 * every unique chunk be embedded once and reused everywhere.
 */
export interface EmbeddingCache {
    /** Return the cached vector for a key, or null on a miss. */
    get(key: string): number[] | null;
    /** Store a vector for a key. Best-effort; failures must not throw. */
    set(key: string, vector: number[]): void;
}

/** Bytes per float in the on-disk vector encoding (Float32). */
const BYTES_PER_FLOAT = 4;

/**
 * Number of hex characters of the key used as a shard subdirectory. Two hex
 * chars => 256 shards, keeping any single directory to a manageable file count
 * even for repositories with hundreds of thousands of chunks.
 */
const SHARD_PREFIX_LENGTH = 2;

/**
 * Compute a stable cache key for a (model, text) pair.
 *
 * A NUL byte separates the two fields so that no (model, text) pair can be
 * confused with another by shifting the boundary between them.
 *
 * @param modelIdentifier Fully qualifies the embedding model (provider + model
 *   name + anything else that changes the output space). Two different models
 *   must never share a key.
 * @param text The exact text handed to the embedder.
 */
export function computeEmbeddingCacheKey(modelIdentifier: string, text: string): string {
    return crypto
        .createHash('sha256')
        .update(modelIdentifier, 'utf-8')
        .update(Buffer.from([0]))
        .update(text, 'utf-8')
        .digest('hex');
}

/**
 * Filesystem-backed {@link EmbeddingCache}. Zero runtime dependencies; stores
 * each vector as a little-endian Float32 blob under a sharded directory tree
 * (mirrors how {@link FileSynchronizer} persists snapshots under `~/.context`).
 *
 * Writes are atomic (temp file + rename) so that concurrent indexers - one per
 * worktree - can safely populate the same cache directory.
 */
export class FileSystemEmbeddingCache implements EmbeddingCache {
    private readonly cacheDir: string;

    constructor(cacheDir?: string) {
        this.cacheDir = cacheDir || FileSystemEmbeddingCache.getDefaultCacheDir();
    }

    static getDefaultCacheDir(): string {
        return path.join(os.homedir(), '.context', 'embedding-cache');
    }

    private pathForKey(key: string): string {
        const shard = key.substring(0, SHARD_PREFIX_LENGTH);
        return path.join(this.cacheDir, shard, key);
    }

    get(key: string): number[] | null {
        try {
            const buffer = fs.readFileSync(this.pathForKey(key));
            if (buffer.length === 0 || buffer.length % BYTES_PER_FLOAT !== 0) {
                return null;
            }
            const floats = new Float32Array(
                buffer.buffer,
                buffer.byteOffset,
                buffer.length / BYTES_PER_FLOAT
            );
            return Array.from(floats);
        } catch {
            // Miss (ENOENT) or unreadable/corrupt entry - treat as a miss.
            return null;
        }
    }

    set(key: string, vector: number[]): void {
        try {
            const filePath = this.pathForKey(key);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const buffer = Buffer.from(new Float32Array(vector).buffer);
            // Atomic write: a concurrent worktree indexer may target the same key.
            const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
            fs.writeFileSync(tmpPath, buffer);
            fs.renameSync(tmpPath, filePath);
        } catch {
            // Best-effort: a cache write failure must never break indexing.
        }
    }
}
