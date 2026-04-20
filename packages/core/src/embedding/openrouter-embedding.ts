import OpenAI from 'openai';
import { Embedding, EmbeddingVector } from './base-embedding';

export interface OpenRouterEmbeddingConfig {
    model: string;
    apiKey: string;
    baseURL?: string;
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterEmbedding extends Embedding {
    private client: OpenAI;
    private config: OpenRouterEmbeddingConfig;
    private dimension: number = 1536;
    protected maxTokens: number = 8192;

    constructor(config: OpenRouterEmbeddingConfig) {
        super();
        this.config = config;
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL || OPENROUTER_BASE_URL,
        });

        const model = config.model || 'openai/text-embedding-3-small';
        const knownModels = OpenRouterEmbedding.getSupportedModels();
        if (knownModels[model]) {
            this.dimension = knownModels[model].dimension;
            this.maxTokens = knownModels[model].maxTokens || 8192;
        }
    }

    async detectDimension(testText: string = "test"): Promise<number> {
        const model = this.config.model || 'openai/text-embedding-3-small';
        const knownModels = OpenRouterEmbedding.getSupportedModels();

        if (knownModels[model]) {
            return knownModels[model].dimension;
        }

        try {
            const processedText = this.preprocessText(testText);
            const response = await this.client.embeddings.create({
                model: model,
                input: processedText,
                encoding_format: 'float',
            });
            return response.data[0].embedding.length;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to detect dimension for model ${model}: ${errorMessage}`);
        }
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const processedText = this.preprocessText(text);
        const model = this.config.model || 'openai/text-embedding-3-small';

        try {
            const response = await this.client.embeddings.create({
                model: model,
                input: processedText,
                encoding_format: 'float',
            });

            this.dimension = response.data[0].embedding.length;

            return {
                vector: response.data[0].embedding,
                dimension: this.dimension
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to generate OpenRouter embedding: ${errorMessage}`);
        }
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const processedTexts = this.preprocessTexts(texts);
        const model = this.config.model || 'openai/text-embedding-3-small';

        try {
            const response = await this.client.embeddings.create({
                model: model,
                input: processedTexts,
                encoding_format: 'float',
            });

            this.dimension = response.data[0].embedding.length;

            return response.data.map((item) => ({
                vector: item.embedding,
                dimension: this.dimension
            }));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to generate OpenRouter batch embeddings: ${errorMessage}`);
        }
    }

    getDimension(): number {
        const model = this.config.model || 'openai/text-embedding-3-small';
        const knownModels = OpenRouterEmbedding.getSupportedModels();

        if (knownModels[model]) {
            return knownModels[model].dimension;
        }

        return this.dimension;
    }

    getProvider(): string {
        return 'OpenRouter';
    }

    async setModel(model: string): Promise<void> {
        this.config.model = model;
        const knownModels = OpenRouterEmbedding.getSupportedModels();
        if (knownModels[model]) {
            this.dimension = knownModels[model].dimension;
            this.maxTokens = knownModels[model].maxTokens || 8192;
        } else {
            this.dimension = await this.detectDimension();
        }
    }

    getClient(): OpenAI {
        return this.client;
    }

    static getSupportedModels(): Record<string, { dimension: number; maxTokens?: number; description: string }> {
        return {
            'openai/text-embedding-3-small': {
                dimension: 1536,
                maxTokens: 8192,
                description: 'OpenAI text-embedding-3-small via OpenRouter'
            },
            'openai/text-embedding-3-large': {
                dimension: 3072,
                maxTokens: 8192,
                description: 'OpenAI text-embedding-3-large via OpenRouter'
            },
            'openai/text-embedding-ada-002': {
                dimension: 1536,
                maxTokens: 8192,
                description: 'OpenAI text-embedding-ada-002 via OpenRouter'
            },
        };
    }
}
