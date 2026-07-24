import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { Embedding, EmbeddingVector } from './base-embedding';
import { CachedEmbedding } from './cached-embedding';
import { FileSystemEmbeddingCache, computeEmbeddingCacheKey } from './embedding-cache';

/** Deterministic fake embedder that counts how many texts it actually embeds. */
class CountingEmbedding extends Embedding {
    protected maxTokens = 1000;
    embedCalls = 0;
    batchCalls = 0;
    embeddedTexts: string[] = [];

    constructor(private readonly modelId = 'Fake:model-a', private readonly dim = 4) {
        super();
    }

    private vectorFor(text: string): number[] {
        // Stable pseudo-vector derived from the text length and first char code.
        const base = (text.length % 7) + 1;
        return Array.from({ length: this.dim }, (_, i) => base + i);
    }

    async embed(text: string): Promise<EmbeddingVector> {
        this.embedCalls++;
        this.embeddedTexts.push(text);
        return { vector: this.vectorFor(text), dimension: this.dim };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        this.batchCalls++;
        this.embeddedTexts.push(...texts);
        return texts.map(t => ({ vector: this.vectorFor(t), dimension: this.dim }));
    }

    async detectDimension(): Promise<number> {
        return this.dim;
    }
    getDimension(): number {
        return this.dim;
    }
    getProvider(): string {
        return 'Fake';
    }
    getModelIdentifier(): string {
        return this.modelId;
    }
}

describe('CachedEmbedding', () => {
    let cacheDir: string;

    beforeEach(() => {
        cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'embcache-'));
    });

    afterEach(() => {
        fs.rmSync(cacheDir, { recursive: true, force: true });
    });

    const newCached = (inner: Embedding) =>
        new CachedEmbedding(inner, new FileSystemEmbeddingCache(cacheDir));

    it('embeds each unique text once and serves repeats from cache', async () => {
        const inner = new CountingEmbedding();
        const first = newCached(inner);
        const r1 = await first.embedBatch(['alpha', 'beta']);
        expect(inner.batchCalls).toBe(1);
        expect(inner.embeddedTexts).toEqual(['alpha', 'beta']);

        // A brand-new wrapper (fresh process) sharing the same cache dir must
        // hit the cache and never call the inner embedder again.
        const inner2 = new CountingEmbedding();
        const second = newCached(inner2);
        const r2 = await second.embedBatch(['alpha', 'beta']);
        expect(inner2.batchCalls).toBe(0);
        expect(r2).toEqual(r1);
    });

    it('only embeds the misses in a partially-cached batch', async () => {
        const inner = new CountingEmbedding();
        const cached = newCached(inner);
        await cached.embedBatch(['alpha', 'beta']);

        const inner2 = new CountingEmbedding();
        const cached2 = newCached(inner2);
        const results = await cached2.embedBatch(['alpha', 'gamma', 'beta']);
        // Only 'gamma' is new; 'alpha' and 'beta' come from the cache.
        expect(inner2.embeddedTexts).toEqual(['gamma']);
        expect(results).toHaveLength(3);
        const direct = await new CountingEmbedding().embedBatch(['alpha', 'gamma', 'beta']);
        expect(results.map(v => v.vector)).toEqual(direct.map(v => v.vector));
    });

    it('preserves input order across cache hits and misses', async () => {
        const inner = new CountingEmbedding();
        const cached = newCached(inner);
        // Prime 'b' only.
        await cached.embedBatch(['b']);

        const inner2 = new CountingEmbedding();
        const cached2 = newCached(inner2);
        const out = await cached2.embedBatch(['a', 'b', 'c']);
        const direct = await new CountingEmbedding().embedBatch(['a', 'b', 'c']);
        expect(out.map(v => v.vector)).toEqual(direct.map(v => v.vector));
    });

    it('does not let two different models share cache entries', async () => {
        const key1 = computeEmbeddingCacheKey('Fake:model-a', 'same text');
        const key2 = computeEmbeddingCacheKey('Fake:model-b', 'same text');
        expect(key1).not.toEqual(key2);
    });

    it('single embed() round-trips through the cache', async () => {
        const inner = new CountingEmbedding();
        const cached = newCached(inner);
        const a = await cached.embed('solo');
        expect(inner.embedCalls).toBe(1);

        const inner2 = new CountingEmbedding();
        const cached2 = newCached(inner2);
        const b = await cached2.embed('solo');
        expect(inner2.embedCalls).toBe(0);
        expect(b.vector).toEqual(a.vector);
    });
});
