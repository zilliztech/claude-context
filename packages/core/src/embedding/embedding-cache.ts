import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { EmbeddingVector } from './base-embedding';
import { envManager } from '../utils/env-manager';

export class EmbeddingCache {
    private cacheDir: string;
    private enabled: boolean;
    private expectedDimension: number | null;

    constructor(model: string, cacheDir?: string, expectedDimension?: number) {
        this.enabled = (envManager.get('EMBEDDING_CACHE') || 'true').toLowerCase() !== 'false';
        this.expectedDimension = expectedDimension ?? null;

        const baseDir = cacheDir
            || envManager.get('EMBEDDING_CACHE_DIR')
            || path.join(os.homedir(), '.context', 'embedding-cache');

        // Sanitize model name for filesystem
        const safeModel = model.replace(/[^a-zA-Z0-9_-]/g, '_');
        this.cacheDir = path.join(baseDir, safeModel);

        if (this.enabled) {
            try {
                fs.mkdirSync(this.cacheDir, { recursive: true });
            } catch {
                console.warn(`[Cache] ⚠️ Could not create cache dir: ${this.cacheDir}`);
                this.enabled = false;
            }
        }
    }

    private hash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Use the FULL sha256 (64 hex chars) as the filename — truncating to 12 chars
     * gave a birthday-collision probability of ~50% at ~78k entries, which is
     * trivially reachable for a real codebase. Full hash makes collisions
     * practically impossible.
     */
    private getCachePath(contentHash: string): string {
        const prefix = contentHash.slice(0, 2);
        return path.join(this.cacheDir, prefix, contentHash + '.json');
    }

    get(content: string): EmbeddingVector | null {
        if (!this.enabled) return null;

        try {
            const h = this.hash(content);
            const cachePath = this.getCachePath(h);

            if (!fs.existsSync(cachePath)) return null;

            const raw = fs.readFileSync(cachePath, 'utf-8');
            const data = JSON.parse(raw);

            // Shape validation — partial writes / future format changes / bit rot
            // shouldn't return garbage to the caller. Treat anything unexpected as a miss.
            if (!data || !Array.isArray(data.v) || typeof data.d !== 'number') return null;
            if (data.v.length !== data.d) return null;
            if (this.expectedDimension !== null && data.d !== this.expectedDimension) return null;

            return { vector: data.v as number[], dimension: data.d };
        } catch {
            return null;
        }
    }

    set(content: string, embedding: EmbeddingVector): void {
        if (!this.enabled) return;

        try {
            const h = this.hash(content);
            const cachePath = this.getCachePath(h);

            fs.mkdirSync(path.dirname(cachePath), { recursive: true });
            fs.writeFileSync(cachePath, JSON.stringify({ v: embedding.vector, d: embedding.dimension }));
        } catch {
            // Silently fail — cache is best-effort
        }
    }

    getBatch(contents: string[]): { results: (EmbeddingVector | null)[]; uncachedIndices: number[] } {
        const results: (EmbeddingVector | null)[] = new Array(contents.length).fill(null);
        const uncachedIndices: number[] = [];

        for (let i = 0; i < contents.length; i++) {
            const cached = this.get(contents[i]);
            if (cached) {
                results[i] = cached;
            } else {
                uncachedIndices.push(i);
            }
        }

        return { results, uncachedIndices };
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Delete cache files not modified in the last maxAgeDays days.
     * Truly async (uses fs.promises) so startup cleanup never blocks the event loop.
     * Best-effort — errors are silently ignored.
     *
     * `maxAgeDays <= 0` (or non-finite) disables cleanup. Documented escape hatch
     * for users who want the cache to persist indefinitely.
     */
    async cleanup(maxAgeDays?: number): Promise<void> {
        if (!this.enabled) return;

        const days = maxAgeDays ?? parseInt(envManager.get('EMBEDDING_CACHE_MAX_AGE_DAYS') || '30', 10);
        if (!Number.isFinite(days) || days <= 0) return;

        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        let deleted = 0;

        try {
            const prefixDirs = await fsp.readdir(this.cacheDir);
            for (const prefix of prefixDirs) {
                const prefixPath = path.join(this.cacheDir, prefix);
                let prefixStat;
                try {
                    prefixStat = await fsp.stat(prefixPath);
                } catch {
                    continue;
                }
                if (!prefixStat.isDirectory()) continue;

                const files = await fsp.readdir(prefixPath);
                for (const file of files) {
                    const filePath = path.join(prefixPath, file);
                    try {
                        const stat = await fsp.stat(filePath);
                        if (stat.mtimeMs < cutoff) {
                            await fsp.unlink(filePath);
                            deleted++;
                        }
                    } catch {
                        // file vanished mid-scan, fine
                    }
                }

                // Remove empty prefix dirs
                try {
                    const remaining = await fsp.readdir(prefixPath);
                    if (remaining.length === 0) await fsp.rmdir(prefixPath);
                } catch {
                    // best-effort
                }
            }

            if (deleted > 0) {
                console.log(`[Cache] 🧹 Cleaned up ${deleted} stale cache files (>${days} days old)`);
            }
        } catch {
            // Best-effort cleanup
        }
    }
}
