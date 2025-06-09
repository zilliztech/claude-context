import OpenAI from 'openai';
import { Embedding, EmbeddingVector } from './index';

export interface OpenAIEmbeddingConfig {
    apiKey: string;
    model?: string;
    baseURL?: string;
}

export class OpenAIEmbeddingService implements Embedding {
    private client: OpenAI;
    private config: OpenAIEmbeddingConfig;
    private dimension: number = 1536; // Default dimension for text-embedding-3-small

    constructor(config: OpenAIEmbeddingConfig) {
        this.config = config;
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
        });

        // Set dimension based on model
        this.updateDimensionForModel(config.model || 'text-embedding-3-small');
    }

    private updateDimensionForModel(model: string): void {
        if (model === 'text-embedding-3-small') {
            this.dimension = 1536;
        } else if (model === 'text-embedding-3-large') {
            this.dimension = 3072;
        } else if (model === 'text-embedding-ada-002') {
            this.dimension = 1536;
        } else {
            this.dimension = 1536; // Default dimension
        }
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const model = this.config.model || 'text-embedding-3-small';

        const response = await this.client.embeddings.create({
            model: model,
            input: text,
            encoding_format: 'float',
        });

        return {
            vector: response.data[0].embedding,
            dimension: this.dimension
        };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const model = this.config.model || 'text-embedding-3-small';

        const response = await this.client.embeddings.create({
            model: model,
            input: texts,
            encoding_format: 'float',
        });

        return response.data.map((item) => ({
            vector: item.embedding,
            dimension: this.dimension
        }));
    }

    getDimension(): number {
        return this.dimension;
    }

    getProvider(): string {
        return 'OpenAI';
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
} 