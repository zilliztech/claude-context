import { GoogleGenAI } from '@google/genai';
import { Embedding, EmbeddingVector } from './base-embedding';

export interface GeminiEmbeddingConfig {
    model: string;
    apiKey: string;
    outputDimensionality?: number; // Optional dimension override
    maxRetries?: number; // Maximum number of retry attempts (default: 3)
    baseDelay?: number; // Base delay in milliseconds for exponential backoff (default: 1000)
}

export class GeminiEmbedding extends Embedding {
    private client: GoogleGenAI;
    private config: GeminiEmbeddingConfig;
    private dimension: number = 3072; // Default dimension for gemini-embedding-001
    protected maxTokens: number = 2048; // Maximum tokens for Gemini embedding models
    private maxRetries: number = 3; // Default retry attempts
    private baseDelay: number = 1000; // Default base delay (1 second)

    constructor(config: GeminiEmbeddingConfig) {
        super();
        this.config = config;
        this.client = new GoogleGenAI({
            apiKey: config.apiKey,
        });

        // Set dimension based on model and configuration
        this.updateDimensionForModel(config.model || 'gemini-embedding-001');

        // Override dimension if specified in config
        if (config.outputDimensionality) {
            this.dimension = config.outputDimensionality;
        }

        // Set retry configuration
        this.maxRetries = config.maxRetries ?? 3;
        this.baseDelay = config.baseDelay ?? 1000;
    }

    private updateDimensionForModel(model: string): void {
        const supportedModels = GeminiEmbedding.getSupportedModels();
        const modelInfo = supportedModels[model];

        if (modelInfo) {
            this.dimension = modelInfo.dimension;
            this.maxTokens = modelInfo.contextLength;
        } else {
            // Use default dimension and context length for unknown models
            this.dimension = 3072;
            this.maxTokens = 2048;
        }
    }

    /**
     * Sleep for given milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Classify error to determine if it's retryable
     */
    private isRetryableError(error: any): boolean {
        if (!error) return false;
        
        // Network-related errors (usually retryable)
        if (error.code === 'ECONNREFUSED' || 
            error.code === 'ETIMEDOUT' || 
            error.code === 'ENOTFOUND' ||
            error.code === 'EAI_AGAIN') {
            return true;
        }

        // HTTP status codes that are retryable
        const status = error.status || error.statusCode;
        if (status === 429 || // Rate limit
            status === 500 || // Internal server error
            status === 502 || // Bad gateway
            status === 503 || // Service unavailable
            status === 504) { // Gateway timeout
            return true;
        }

        // Error messages that indicate retryable conditions
        const message = error.message?.toLowerCase() || '';
        if (message.includes('rate limit') ||
            message.includes('quota exceeded') ||
            message.includes('service unavailable') ||
            message.includes('timeout') ||
            message.includes('connection') ||
            message.includes('network')) {
            return true;
        }

        return false;
    }

    /**
     * Execute operation with exponential backoff retry
     */
    private async executeWithRetry<T>(
        operation: () => Promise<T>,
        context: string
    ): Promise<T> {
        let lastError: any;
        
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                // Don't retry on last attempt
                if (attempt === this.maxRetries) {
                    break;
                }

                // Check if error is retryable
                if (!this.isRetryableError(error)) {
                    console.log(`[Gemini] Non-retryable error in ${context}, not retrying:`, error instanceof Error ? error.message : String(error));
                    throw error;
                }

                // Calculate exponential backoff delay
                const delay = Math.min(this.baseDelay * Math.pow(2, attempt), 10000); // Max 10 seconds
                console.log(`[Gemini] ${context} attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error instanceof Error ? error.message : String(error));
                
                await this.sleep(delay);
            }
        }

        // All attempts failed
        throw new Error(`Gemini ${context} failed after ${this.maxRetries + 1} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
    }

    async detectDimension(): Promise<number> {
        // Gemini doesn't need dynamic detection, return configured dimension
        return this.dimension;
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const processedText = this.preprocessText(text);
        const model = this.config.model || 'gemini-embedding-001';

        return this.executeWithRetry(async () => {
            const response = await this.client.models.embedContent({
                model: model,
                contents: processedText,
                config: {
                    outputDimensionality: this.config.outputDimensionality || this.dimension,
                },
            });

            if (!response.embeddings || !response.embeddings[0] || !response.embeddings[0].values) {
                throw new Error('Gemini API returned invalid response');
            }

            return {
                vector: response.embeddings[0].values,
                dimension: response.embeddings[0].values.length
            };
        }, 'embedding');
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const processedTexts = this.preprocessTexts(texts);
        const model = this.config.model || 'gemini-embedding-001';

        return this.executeWithRetry(async () => {
            try {
                // Try batch processing first
                const response = await this.client.models.embedContent({
                    model: model,
                    contents: processedTexts,
                    config: {
                        outputDimensionality: this.config.outputDimensionality || this.dimension,
                    },
                });

                if (!response.embeddings) {
                    throw new Error('Gemini API returned invalid response');
                }

                return response.embeddings.map((embedding: any) => {
                    if (!embedding.values) {
                        throw new Error('Gemini API returned invalid embedding data');
                    }
                    return {
                        vector: embedding.values,
                        dimension: embedding.values.length
                    };
                });
            } catch (error) {
                // If batch processing fails, fall back to individual processing
                console.log(`[Gemini] Batch processing failed, falling back to individual processing: ${error instanceof Error ? error.message : String(error)}`);
                
                const results: EmbeddingVector[] = [];
                for (const text of processedTexts) {
                    const result = await this.embed(text);
                    results.push(result);
                }
                return results;
            }
        }, 'batch embedding');
    }

    getDimension(): number {
        return this.dimension;
    }

    getProvider(): string {
        return 'Gemini';
    }

    /**
     * Set model type
     * @param model Model name
     */
    setModel(model: string): void {
        this.config.model = model;
        this.updateDimensionForModel(model);
    }

    /**
     * Set output dimensionality
     * @param dimension Output dimension (must be supported by the model)
     */
    setOutputDimensionality(dimension: number): void {
        this.config.outputDimensionality = dimension;
        this.dimension = dimension;
    }

    /**
     * Set maximum retry attempts
     * @param maxRetries Maximum number of retry attempts
     */
    setMaxRetries(maxRetries: number): void {
        this.config.maxRetries = maxRetries;
        this.maxRetries = maxRetries;
    }

    /**
     * Set base delay for exponential backoff
     * @param baseDelay Base delay in milliseconds
     */
    setBaseDelay(baseDelay: number): void {
        this.config.baseDelay = baseDelay;
        this.baseDelay = baseDelay;
    }

    /**
     * Get retry configuration
     */
    getRetryConfig(): { maxRetries: number; baseDelay: number } {
        return {
            maxRetries: this.maxRetries,
            baseDelay: this.baseDelay
        };
    }

    /**
     * Get client instance (for advanced usage)
     */
    getClient(): GoogleGenAI {
        return this.client;
    }

    /**
     * Get list of supported models
     */
    static getSupportedModels(): Record<string, { dimension: number; contextLength: number; description: string; supportedDimensions?: number[] }> {
        return {
            'gemini-embedding-001': {
                dimension: 3072,
                contextLength: 2048,
                description: 'Latest Gemini embedding model with state-of-the-art performance (recommended)',
                supportedDimensions: [3072, 1536, 768, 256] // Matryoshka Representation Learning support
            }
        };
    }

    /**
     * Get supported dimensions for the current model
     */
    getSupportedDimensions(): number[] {
        const modelInfo = GeminiEmbedding.getSupportedModels()[this.config.model || 'gemini-embedding-001'];
        return modelInfo?.supportedDimensions || [this.dimension];
    }

    /**
     * Validate if a dimension is supported by the current model
     */
    isDimensionSupported(dimension: number): boolean {
        const supportedDimensions = this.getSupportedDimensions();
        return supportedDimensions.includes(dimension);
    }
}
