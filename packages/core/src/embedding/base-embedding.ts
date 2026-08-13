// Interface definitions
export interface EmbeddingVector {
    vector: number[];
    dimension: number;
}

/**
 * Abstract base class for embedding implementations
 */
export abstract class Embedding {
    protected abstract maxTokens: number;

    /**
     * Preprocess text to ensure it's valid for embedding
     * @param text Input text
     * @returns Processed text
     */
    protected preprocessText(text: string): string {
        // Replace empty string with single space
        if (text === '') {
            return ' ';
        }

        // Simple character-based truncation (approximation)
        // Each token is roughly 4 characters on average for English text
        const maxChars = this.maxTokens * 4;
        if (text.length > maxChars) {
            return text.substring(0, maxChars);
        }

        return text;
    }

    /**
     * Detect embedding dimension 
     * @param testText Test text for dimension detection
     * @returns Embedding dimension
     */
    abstract detectDimension(testText?: string): Promise<number>;

    /**
     * Preprocess array of texts
     * @param texts Array of input texts
     * @returns Array of processed texts
     */
    protected preprocessTexts(texts: string[]): string[] {
        return texts.map(text => this.preprocessText(text));
    }

    // Abstract methods that must be implemented by subclasses
    /**
     * Generate text embedding vector
     * @param text Text content
     * @returns Embedding vector
     */
    abstract embed(text: string): Promise<EmbeddingVector>;

    /**
     * Generate text embedding vectors in batch
     * @param texts Text array
     * @returns Embedding vector array
     */
    abstract embedBatch(texts: string[]): Promise<EmbeddingVector[]>;

    /**
     * Get embedding vector dimension
     * @returns Vector dimension
     */
    abstract getDimension(): number;

    /**
     * Get service provider name
     * @returns Provider name
     */
    abstract getProvider(): string;
} 