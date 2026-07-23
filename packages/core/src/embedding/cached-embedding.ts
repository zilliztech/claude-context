import { Embedding, EmbeddingVector } from './base-embedding';
import { EmbeddingCache, computeEmbeddingCacheKey } from './embedding-cache';

/**
 * Wraps any {@link Embedding} provider with a content-addressed cache so that
 * an identical chunk of text is only sent to the underlying embedder once,
 * ever — across every collection indexed on this machine.
 *
 * Correctness rests on two facts: embeddings are deterministic for a given
 * (model, text) pair, and {@link Embedding.getModelIdentifier} fully qualifies
 * the model. The cache key mixes both, so two different models can never
 * return each other's vectors. Caching never changes results; it only avoids
 * recomputation.
 *
 * The wrapper is transparent: it delegates dimension detection and metadata to
 * the inner provider and preserves input→output ordering for batches.
 */
export class CachedEmbedding extends Embedding {
    // Unused: caching keys on the exact text the caller passes, so this wrapper
    // never invokes the base preprocessing path.
    protected maxTokens = Number.MAX_SAFE_INTEGER;

    constructor(
        private readonly inner: Embedding,
        private readonly cache: EmbeddingCache
    ) {
        super();
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const key = computeEmbeddingCacheKey(this.inner.getModelIdentifier(), text);
        const cached = this.cache.get(key);
        if (cached) {
            return { vector: cached, dimension: cached.length };
        }
        const result = await this.inner.embed(text);
        this.cache.set(key, result.vector);
        return result;
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const modelId = this.inner.getModelIdentifier();
        const results = new Array<EmbeddingVector | undefined>(texts.length);
        const missTexts: string[] = [];
        const missIndexes: number[] = [];
        const missKeys: string[] = [];

        texts.forEach((text, i) => {
            const key = computeEmbeddingCacheKey(modelId, text);
            const cached = this.cache.get(key);
            if (cached) {
                results[i] = { vector: cached, dimension: cached.length };
            } else {
                missTexts.push(text);
                missIndexes.push(i);
                missKeys.push(key);
            }
        });

        if (missTexts.length > 0) {
            const embedded = await this.inner.embedBatch(missTexts);
            // Stay faithful to a misbehaving provider: if it did not return
            // exactly one vector per requested text, do not reshape by index —
            // pass the raw result through so the caller's length validation can
            // reject it. Reassembling would mask empty or mismatched batches.
            if (embedded.length !== missTexts.length) {
                return embedded;
            }
            embedded.forEach((vec, j) => {
                results[missIndexes[j]] = vec;
                this.cache.set(missKeys[j], vec.vector);
            });
        }

        return results as EmbeddingVector[];
    }

    async detectDimension(testText?: string): Promise<number> {
        return this.inner.detectDimension(testText);
    }

    getDimension(): number {
        return this.inner.getDimension();
    }

    getProvider(): string {
        return this.inner.getProvider();
    }

    getModelIdentifier(): string {
        return this.inner.getModelIdentifier();
    }
}
