/**
 * Browser-side embedding provider interface.
 * All providers in this folder implement EmbeddingProvider so background.ts
 * can stay provider-agnostic via the factory.
 */

export type EmbeddingProviderName = 'OpenAI' | 'VoyageAI' | 'Gemini' | 'OpenRouter';

export interface EmbeddingProvider {
    /** Human-readable name, used in logs and error messages. */
    name: EmbeddingProviderName;

    /** Vector dimension this provider/model returns. */
    dimension: number;

    /** Embed a batch of texts. Returns vectors in the same order. */
    embedBatch(texts: string[]): Promise<number[][]>;

    /** Convenience: embed a single text. Default impl wraps embedBatch. */
    embedSingle(text: string): Promise<number[]>;
}

export const EMBEDDING_STORAGE_KEYS = {
    provider: 'embeddingProvider',
    model: 'embeddingModel',
    openaiToken: 'openaiToken',
    voyageaiToken: 'voyageaiToken',
    voyageaiBaseUrl: 'voyageaiBaseUrl',
    geminiToken: 'geminiToken',
    openrouterToken: 'openrouterToken',
} as const;

export interface EmbeddingStorageShape {
    embeddingProvider?: EmbeddingProviderName;
    embeddingModel?: string;
    openaiToken?: string;
    voyageaiToken?: string;
    voyageaiBaseUrl?: string;
    geminiToken?: string;
    openrouterToken?: string;
}
