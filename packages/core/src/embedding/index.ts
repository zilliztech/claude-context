// Interface definitions
export interface EmbeddingVector {
    vector: number[];
    dimension: number;
}

export interface Embedding {
    /**
     * Generate text embedding vector
     * @param text Text content
     * @returns Embedding vector
     */
    embed(text: string): Promise<EmbeddingVector>;

    /**
     * Generate text embedding vectors in batch
     * @param texts Text array
     * @returns Embedding vector array
     */
    embedBatch(texts: string[]): Promise<EmbeddingVector[]>;

    /**
     * Get embedding vector dimension
     * @returns Vector dimension
     */
    getDimension(): number;

    /**
     * Get service provider name
     * @returns Provider name
     */
    getProvider(): string;
}

// Implementation class exports
export * from './openai-embedding';
export * from './voyageai-embedding';
export * from './ollama-embedding'; 