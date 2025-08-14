import OpenAI from 'openai';
import { Embedding, EmbeddingVector } from './base-embedding';

export interface OpenAIEmbeddingConfig {
    model: string;
    apiKey: string;
    baseURL?: string; // OpenAI supports custom baseURL
    useOllamaModel?: boolean; // Whether this is actually an Ollama model via OAPI forwarding
}

// Constants
const DEFAULT_OLLAMA_DIMENSION = 768;
const OPENAI_API_DOMAIN = 'api.openai.com';

export class OpenAIEmbedding extends Embedding {
    private client: OpenAI;
    private config: OpenAIEmbeddingConfig;
    private dimension: number = 1536; // Default dimension for text-embedding-3-small
    private dimensionDetected: boolean = false; // Track if dimension has been detected
    private dimensionDetectionPromise: Promise<number> | null = null; // Track detection process
    protected maxTokens: number = 8192; // Maximum tokens for OpenAI embedding models
    private isOllamaViaOAPI: boolean = false; // Whether using Ollama model via OAPI
    private isOllamaDimensionDetected: boolean = false; // Track if OAPI dimension has been detected
    private ollamaDimensionDetectionPromise: Promise<number> | null = null; // Track OAPI detection process

    constructor(config: OpenAIEmbeddingConfig) {
        super();
        this.config = config;
        
        // Check environment variable for Ollama via OAPI
        this.isOllamaViaOAPI = config.useOllamaModel || 
                              (process.env.OPENAI_CUSTOM_BASE_USING_OLLAMA_MODEL || '').toLowerCase() === 'true';
        
        // Auto-correct baseURL if needed
        const correctedBaseURL = this.correctBaseURL(config.baseURL);
        
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: correctedBaseURL,
        });
        
        if (this.isOllamaViaOAPI) {
            console.log(`[OpenAI] Configured for Ollama model ${config.model} via OAPI forwarding`);
            // Reset dimension since Ollama models have different dimensions
            this.dimension = DEFAULT_OLLAMA_DIMENSION; // Common Ollama embedding dimension
        } else {
            // Set dimension detection flag for known models
            const knownModels = OpenAIEmbedding.getSupportedModels();
            if (knownModels[config.model]) {
                this.dimension = knownModels[config.model].dimension;
                this.dimensionDetected = true;
            }
        }
    }

    /**
     * Correct baseURL by adding /v1 if needed for OpenAI compatibility
     */
    private correctBaseURL(baseURL?: string): string | undefined {
        if (!baseURL) return baseURL;
        
        // If it's the official OpenAI API, don't modify
        if (baseURL.includes(OPENAI_API_DOMAIN)) {
            return baseURL;
        }
        
        // For custom endpoints, ensure /v1 path is present
        if (!baseURL.endsWith('/v1') && !baseURL.includes('/v1/')) {
            const normalizedURL = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
            console.log(`[OpenAI] Auto-correcting baseURL: ${baseURL} → ${normalizedURL}/v1`);
            return `${normalizedURL}/v1`;
        }
        
        return baseURL;
    }

    async detectDimension(testText: string = "test"): Promise<number> {
        const model = this.config.model || 'text-embedding-3-small';
        
        // Special handling for Ollama models via OAPI
        if (this.isOllamaViaOAPI) {
            return this.detectOllamaDimensionViaOAPI(testText, model);
        }
        
        // Standard OpenAI dimension detection
        const knownModels = OpenAIEmbedding.getSupportedModels();

        // Use known dimension for standard models
        if (knownModels[model]) {
            return knownModels[model].dimension;
        }

        // For custom models, make API call to detect dimension
        try {
            const processedText = this.preprocessText(testText);
            const response = await this.client.embeddings.create({
                model: model,
                input: processedText,
                encoding_format: 'float',
            });
            
            if (!response.data || response.data.length === 0) {
                throw new Error(OpenAIEmbedding.getEmptyResponseError());
            }
            
            return response.data[0].embedding.length;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            // Re-throw authentication errors
            if (errorMessage.includes('API key') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
                throw new Error(`Failed to detect dimension for model ${model}: ${errorMessage}`);
            }

            // For other errors, throw exception instead of using fallback
            throw new Error(`Failed to detect dimension for model ${model}: ${errorMessage}`);
        }
    }
    
    /**
     * Detect dimension for Ollama models accessed via OAPI
     */
    private async detectOllamaDimensionViaOAPI(testText: string, model: string): Promise<number> {
        console.log(`[OpenAI] Detecting Ollama model dimension via OAPI for ${model}...`);
        
        try {
            const processedText = this.preprocessText(testText);
            const response = await this.client.embeddings.create({
                model: model,
                input: processedText,
                encoding_format: 'float',
            });
            
            if (!response.data || response.data.length === 0) {
                throw new Error(OpenAIEmbedding.getOllamaEmptyResponseError(model));
            }
            
            const dimension = response.data[0].embedding.length;
            console.log(`[OpenAI] Detected Ollama dimension via OAPI: ${dimension}`);
            return dimension;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to detect Ollama dimension via OAPI for ${model}: ${errorMessage}. Ensure OPENAI_CUSTOM_BASE_USING_OLLAMA_MODEL=true is set correctly.`);
        }
    }

    async embed(text: string): Promise<EmbeddingVector> {
        // Special handling for Ollama models via OAPI
        if (this.isOllamaViaOAPI) {
            return this.embedOllamaViaOAPI(text);
        }
        
        // Standard OpenAI embedding logic
        const processedText = this.preprocessText(text);
        const model = this.config.model || 'text-embedding-3-small';

        const knownModels = OpenAIEmbedding.getSupportedModels();
        if (knownModels[model] && this.dimension !== knownModels[model].dimension) {
            this.dimension = knownModels[model].dimension;
            this.dimensionDetected = true;
        } else if (!knownModels[model] && !this.dimensionDetected) {
            await this.ensureDimensionDetected(model);
        }

        try {
            const response = await this.client.embeddings.create({
                model: model,
                input: processedText,
                encoding_format: 'float',
            });

            // Validate response before accessing data
            if (!response.data || response.data.length === 0) {
                throw new Error(OpenAIEmbedding.getEmptyResponseError());
            }
            
            return {
                vector: response.data[0].embedding,
                dimension: this.dimension
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to generate OpenAI embedding: ${errorMessage}`);
        }
    }
    
    /**
     * Embed text using Ollama model via OAPI forwarding
     */
    private async embedOllamaViaOAPI(text: string): Promise<EmbeddingVector> {
        const processedText = this.preprocessText(text);
        const model = this.config.model;
        
        // Detect dimension if not already detected for Ollama
        if (!this.isOllamaDimensionDetected) {
            await this.ensureOllamaDimensionDetected(model);
        }
        
        try {
            const response = await this.client.embeddings.create({
                model: model,
                input: processedText,
                encoding_format: 'float',
            });
            
            if (!response.data || response.data.length === 0) {
                throw new Error(`OAPI forwarding returned empty response for Ollama model ${model}. Check OAPI service and Ollama model availability.`);
            }
            
            return {
                vector: response.data[0].embedding,
                dimension: this.dimension
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to embed via OAPI for Ollama model ${model}: ${errorMessage}`);
        }
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        // Special handling for Ollama models via OAPI
        if (this.isOllamaViaOAPI) {
            return this.embedBatchOllamaViaOAPI(texts);
        }
        
        // Standard OpenAI batch embedding
        const processedTexts = this.preprocessTexts(texts);
        const model = this.config.model || 'text-embedding-3-small';

        const knownModels = OpenAIEmbedding.getSupportedModels();
        if (knownModels[model] && this.dimension !== knownModels[model].dimension) {
            this.dimension = knownModels[model].dimension;
            this.dimensionDetected = true;
        } else if (!knownModels[model] && !this.dimensionDetected) {
            await this.ensureDimensionDetected(model);
        }

        try {
            const response = await this.client.embeddings.create({
                model: model,
                input: processedTexts,
                encoding_format: 'float',
            });

            // Validate response array length matches input
            if (!response.data || response.data.length !== processedTexts.length) {
                throw new Error(OpenAIEmbedding.getBatchMismatchError(response.data?.length || 0, processedTexts.length));
            }

            return response.data.map((item) => ({
                vector: item.embedding,
                dimension: this.dimension
            }));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to generate OpenAI batch embeddings: ${errorMessage}`);
        }
    }
    
    /**
     * Batch embed using Ollama model via OAPI forwarding
     */
    private async embedBatchOllamaViaOAPI(texts: string[]): Promise<EmbeddingVector[]> {
        console.log(`[OpenAI] Batch embedding ${texts.length} texts with Ollama model ${this.config.model} via OAPI...`);
        
        const processedTexts = this.preprocessTexts(texts);
        const model = this.config.model;
        
        // Detect dimension if not already detected for Ollama
        if (!this.isOllamaDimensionDetected) {
            await this.ensureOllamaDimensionDetected(model);
        }
        
        try {
            const response = await this.client.embeddings.create({
                model: model,
                input: processedTexts,
                encoding_format: 'float',
            });
            
            // Critical validation for OAPI forwarding to Ollama
            if (!response.data || response.data.length !== processedTexts.length) {
                throw new Error(OpenAIEmbedding.getOllamaBatchMismatchError(response.data?.length || 0, processedTexts.length, model));
            }
            
            return response.data.map((item) => ({
                vector: item.embedding,
                dimension: this.dimension
            }));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to batch embed via OAPI for Ollama model ${model}: ${errorMessage}`);
        }
    }

    getDimension(): number {
        // For custom models, we need to detect the dimension first
        const model = this.config.model || 'text-embedding-3-small';
        const knownModels = OpenAIEmbedding.getSupportedModels();

        // If it's a known model, return its known dimension
        if (knownModels[model]) {
            return knownModels[model].dimension;
        }

        // For custom models, return the current dimension
        // Note: This may be incorrect until detectDimension() is called
        console.warn(`[OpenAIEmbedding] ⚠️ getDimension() called for custom model '${model}' - returning ${this.dimension}. Call detectDimension() first for accurate dimension.`);
        return this.dimension;
    }

    getProvider(): string {
        return 'OpenAI';
    }

    /**
     * Set model type
     * @param model Model name
     */
    async setModel(model: string): Promise<void> {
        this.config.model = model;
        
        // Reset all detection states
        this.dimensionDetected = false;
        this.isOllamaDimensionDetected = false;
        this.dimensionDetectionPromise = null;
        this.ollamaDimensionDetectionPromise = null;

        const knownModels = OpenAIEmbedding.getSupportedModels();

        if (knownModels[model] && !this.isOllamaViaOAPI) {
            // Known OpenAI model
            this.dimension = knownModels[model].dimension;
            this.dimensionDetected = true;
        } else {
            // Unknown model or OAPI model - detect dimension
            if (this.isOllamaViaOAPI) {
                await this.ensureOllamaDimensionDetected(model);
            } else {
                await this.ensureDimensionDetected(model);
            }
        }
    }

    /**
     * Get client instance (for advanced usage)
     */
    getClient(): OpenAI {
        return this.client;
    }

    /**
     * Get list of supported models
     */
    static getSupportedModels(): Record<string, { dimension: number; description: string }> {
        return {
            'text-embedding-3-small': {
                dimension: 1536,
                description: 'High performance and cost-effective embedding model (recommended)'
            },
            'text-embedding-3-large': {
                dimension: 3072,
                description: 'Highest performance embedding model with larger dimensions'
            },
            'text-embedding-ada-002': {
                dimension: 1536,
                description: 'Legacy model (use text-embedding-3-small instead)'
            }
        };
    }

    /**
     * Error message generators for consistent error reporting
     */
    private static getEmptyResponseError(): string {
        return `API returned empty response. This might indicate: 1) Incorrect baseURL (missing /v1?), 2) Invalid API key, 3) Model not available, or 4) Input text was filtered out`;
    }

    private static getOllamaEmptyResponseError(model: string): string {
        return `OAPI forwarding returned empty response for Ollama model ${model}. Check: 1) OAPI service is running, 2) Ollama model is available, 3) API key is valid for OAPI service`;
    }

    private static getBatchMismatchError(actual: number, expected: number): string {
        return `API returned ${actual} embeddings but expected ${expected}. This might indicate: 1) Some texts were filtered/rejected, 2) API rate limiting, 3) Invalid API key, or 4) OAPI forwarding issues`;
    }

    private static getOllamaBatchMismatchError(actual: number, expected: number, model: string): string {
        return `OAPI forwarding returned ${actual} embeddings but expected ${expected} for Ollama model ${model}. This indicates: 1) Some texts were rejected by Ollama, 2) OAPI service issues, 3) Ollama model capacity limits. Check OAPI logs and Ollama status.`;
    }

    /**
     * Ensure dimension is detected for standard OpenAI models (race condition safe)
     */
    private async ensureDimensionDetected(model: string): Promise<void> {
        if (this.dimensionDetected) {
            return;
        }

        if (this.dimensionDetectionPromise) {
            await this.dimensionDetectionPromise;
            return;
        }

        this.dimensionDetectionPromise = this.detectDimension();
        try {
            this.dimension = await this.dimensionDetectionPromise;
            this.dimensionDetected = true;
        } finally {
            this.dimensionDetectionPromise = null;
        }
    }

    /**
     * Ensure OAPI dimension is detected for Ollama models (race condition safe)
     */
    private async ensureOllamaDimensionDetected(model: string): Promise<void> {
        if (this.isOllamaDimensionDetected) {
            return;
        }

        if (this.ollamaDimensionDetectionPromise) {
            await this.ollamaDimensionDetectionPromise;
            return;
        }

        this.ollamaDimensionDetectionPromise = this.detectOllamaDimensionViaOAPI('test', model);
        try {
            this.dimension = await this.ollamaDimensionDetectionPromise;
            this.isOllamaDimensionDetected = true;
        } finally {
            this.ollamaDimensionDetectionPromise = null;
        }
    }
} 