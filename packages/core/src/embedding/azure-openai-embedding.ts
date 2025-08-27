import { AzureOpenAI } from 'openai';
import { Embedding, EmbeddingVector } from './base-embedding';

export interface AzureOpenAIEmbeddingConfig {
    deploymentName: string;  // Azure deployment name (not model name)
    apiKey: string;          // Azure OpenAI API key
    azureEndpoint: string;   // Required: Azure endpoint URL
    apiVersion?: string;     // Optional: defaults to stable version
}

export class AzureOpenAIEmbedding extends Embedding {
    private client: AzureOpenAI;
    private config: AzureOpenAIEmbeddingConfig;
    private dimension: number = 1536; // Default dimension for text-embedding-3-small
    protected maxTokens: number = 8192; // Maximum tokens for OpenAI embedding models

    constructor(config: AzureOpenAIEmbeddingConfig) {
        super();
        this.config = config;
        
        // Validate endpoint format
        if (!config.azureEndpoint.startsWith('https://')) {
            throw new Error('Azure OpenAI endpoint must start with https://');
        }
        
        // Initialize Azure OpenAI client with API key authentication
        this.client = new AzureOpenAI({
            apiKey: config.apiKey,
            apiVersion: config.apiVersion || '2024-02-01', // Use stable version
            endpoint: config.azureEndpoint,
        });
    }

    async detectDimension(testText: string = "test"): Promise<number> {
        const knownModels = AzureOpenAIEmbedding.getSupportedModels();
        
        // Try to infer from deployment name if it matches known patterns
        // Azure deployment names often include the model name with dashes
        for (const [modelName, info] of Object.entries(knownModels)) {
            // Check if deployment name contains model pattern (with dashes instead of dots)
            const modelPattern = modelName.replace(/\./g, '-');
            if (this.config.deploymentName.toLowerCase().includes(modelPattern)) {
                return info.dimension;
            }
        }

        // Dynamic detection via API call for custom deployments
        try {
            const processedText = this.preprocessText(testText);
            const response = await this.client.embeddings.create({
                model: this.config.deploymentName, // Use deployment name
                input: processedText,
                encoding_format: 'float',
            });
            return response.data[0].embedding.length;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            // Re-throw authentication errors
            if (errorMessage.includes('API key') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
                throw new Error(`Azure OpenAI authentication failed: ${errorMessage}`);
            }
            
            // Handle deployment not found errors
            if (errorMessage.includes('deployment') || errorMessage.includes('not found')) {
                throw new Error(`Azure OpenAI deployment '${this.config.deploymentName}' not found: ${errorMessage}`);
            }
            
            throw new Error(`Failed to detect dimension for Azure deployment ${this.config.deploymentName}: ${errorMessage}`);
        }
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const processedText = this.preprocessText(text);
        
        // Check if we need to detect dimension
        const knownModels = AzureOpenAIEmbedding.getSupportedModels();
        let needsDimensionDetection = true;
        
        for (const [modelName, info] of Object.entries(knownModels)) {
            const modelPattern = modelName.replace(/\./g, '-');
            if (this.config.deploymentName.toLowerCase().includes(modelPattern)) {
                this.dimension = info.dimension;
                needsDimensionDetection = false;
                break;
            }
        }
        
        if (needsDimensionDetection && this.dimension === 1536) {
            // Only detect if we haven't already and are using default
            this.dimension = await this.detectDimension();
        }
        
        try {
            const response = await this.client.embeddings.create({
                model: this.config.deploymentName, // Use deployment name
                input: processedText,
                encoding_format: 'float',
            });

            // Update dimension from actual response
            this.dimension = response.data[0].embedding.length;

            return {
                vector: response.data[0].embedding,
                dimension: this.dimension
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            // Provide specific error messages for common Azure issues
            if (errorMessage.includes('API key') || errorMessage.includes('unauthorized')) {
                throw new Error(`Azure OpenAI authentication failed: ${errorMessage}`);
            }
            
            if (errorMessage.includes('deployment') || errorMessage.includes('not found')) {
                throw new Error(`Azure OpenAI deployment '${this.config.deploymentName}' not found: ${errorMessage}`);
            }
            
            if (errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
                throw new Error(`Azure OpenAI rate limit exceeded: ${errorMessage}`);
            }
            
            throw new Error(`Failed to generate Azure OpenAI embedding: ${errorMessage}`);
        }
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const processedTexts = this.preprocessTexts(texts);
        
        // Check if we need to detect dimension
        const knownModels = AzureOpenAIEmbedding.getSupportedModels();
        let needsDimensionDetection = true;
        
        for (const [modelName, info] of Object.entries(knownModels)) {
            const modelPattern = modelName.replace(/\./g, '-');
            if (this.config.deploymentName.toLowerCase().includes(modelPattern)) {
                this.dimension = info.dimension;
                needsDimensionDetection = false;
                break;
            }
        }
        
        if (needsDimensionDetection && this.dimension === 1536) {
            this.dimension = await this.detectDimension();
        }
        
        try {
            const response = await this.client.embeddings.create({
                model: this.config.deploymentName, // Use deployment name
                input: processedTexts,
                encoding_format: 'float',
            });

            // Update dimension from actual response
            this.dimension = response.data[0].embedding.length;

            return response.data.map((item) => ({
                vector: item.embedding,
                dimension: this.dimension
            }));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            // Provide specific error messages for common Azure issues
            if (errorMessage.includes('API key') || errorMessage.includes('unauthorized')) {
                throw new Error(`Azure OpenAI authentication failed: ${errorMessage}`);
            }
            
            if (errorMessage.includes('deployment') || errorMessage.includes('not found')) {
                throw new Error(`Azure OpenAI deployment '${this.config.deploymentName}' not found: ${errorMessage}`);
            }
            
            if (errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
                throw new Error(`Azure OpenAI rate limit exceeded: ${errorMessage}`);
            }
            
            throw new Error(`Failed to generate Azure OpenAI batch embeddings: ${errorMessage}`);
        }
    }

    getDimension(): number {
        // Check if deployment name matches known models
        const knownModels = AzureOpenAIEmbedding.getSupportedModels();
        
        for (const [modelName, info] of Object.entries(knownModels)) {
            const modelPattern = modelName.replace(/\./g, '-');
            if (this.config.deploymentName.toLowerCase().includes(modelPattern)) {
                return info.dimension;
            }
        }
        
        // For custom deployments, return the current dimension
        // Note: This may be incorrect until detectDimension() is called
        console.warn(`[AzureOpenAIEmbedding] ⚠️ getDimension() called for deployment '${this.config.deploymentName}' - returning ${this.dimension}. Call detectDimension() first for accurate dimension.`);
        return this.dimension;
    }

    getProvider(): string {
        return 'Azure OpenAI';
    }

    /**
     * Set deployment name
     * @param deploymentName Azure deployment name
     */
    async setDeployment(deploymentName: string): Promise<void> {
        this.config.deploymentName = deploymentName;
        
        // Check if this matches a known model
        const knownModels = AzureOpenAIEmbedding.getSupportedModels();
        let foundKnownModel = false;
        
        for (const [modelName, info] of Object.entries(knownModels)) {
            const modelPattern = modelName.replace(/\./g, '-');
            if (deploymentName.toLowerCase().includes(modelPattern)) {
                this.dimension = info.dimension;
                foundKnownModel = true;
                break;
            }
        }
        
        if (!foundKnownModel) {
            // Detect dimension for custom deployment
            this.dimension = await this.detectDimension();
        }
    }

    /**
     * Get client instance (for advanced usage)
     */
    getClient(): AzureOpenAI {
        return this.client;
    }

    /**
     * Get list of supported models (these are OpenAI model names, not Azure deployment names)
     * Azure deployments can be named anything, but often include the model name
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
}