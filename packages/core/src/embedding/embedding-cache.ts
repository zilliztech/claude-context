import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { EmbeddingVector } from './base-embedding';
import { envManager } from '../utils/env-manager';

export class EmbeddingCache {
    private cacheDir: string;
    private enabled: boolean;

    constructor(model: string, cacheDir?: string) {
        this.enabled = (envManager.get('EMBEDDING_CACHE') || 'true').toLowerCase() !== 'false';

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

    private getCachePath(contentHash: string): string {
        const prefix = contentHash.slice(0, 2);
        return path.join(this.cacheDir, prefix, contentHash.slice(0, 12) + '.json');
    }

    get(content: string): EmbeddingVector | null {
        if (!this.enabled) return null;

        try {
            const h = this.hash(content);
            const cachePath = this.getCachePath(h);

            if (!fs.existsSync(cachePath)) return null;

            const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
            return { vector: data.v, dimension: data.d };
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
}
