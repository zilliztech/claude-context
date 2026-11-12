import { VoyageAIClient } from 'voyageai';
import { Reranker, RerankResult } from './base-reranker';

export interface VoyageAIRerankerConfig {
    apiKey: string;
    model?: string;
}

export class VoyageAIReranker extends Reranker {
    static readonly DEFAULT_MODEL = 'rerank-2.5';

    private client: VoyageAIClient;
    private model: string;

    constructor(config: VoyageAIRerankerConfig) {
        super();
        this.model = config.model || VoyageAIReranker.DEFAULT_MODEL;
        this.client = new VoyageAIClient({
            apiKey: config.apiKey,
        });
    }

    async rerank(query: string, documents: string[], topK?: number): Promise<RerankResult[]> {
        if (documents.length === 0) {
            return [];
        }

        const response = await this.client.rerank({
            query,
            documents,
            model: this.model,
            ...(topK !== undefined && { topK }),
            truncation: true,
        });

        if (!response.data) {
            throw new Error('VoyageAI rerank API returned invalid response');
        }

        return response.data.map((item) => {
            if (typeof item.index !== 'number' || typeof item.relevanceScore !== 'number') {
                throw new Error('VoyageAI rerank API returned invalid response');
            }
            return { index: item.index, score: item.relevanceScore };
        });
    }

    getProvider(): string {
        return 'VoyageAI';
    }

    getModel(): string {
        return this.model;
    }

    /**
     * Get client instance (for advanced usage)
     */
    getClient(): VoyageAIClient {
        return this.client;
    }

    /**
     * Get list of supported models
     */
    static getSupportedModels(): Record<string, { contextLength: number; description: string }> {
        return {
            'rerank-2.5': {
                contextLength: 32000,
                description: 'Best reranking quality, with instruction-following support'
            },
            'rerank-2.5-lite': {
                contextLength: 32000,
                description: 'Optimized for latency and cost'
            },
            'rerank-2': {
                contextLength: 16000,
                description: 'Previous generation reranker'
            },
            'rerank-2-lite': {
                contextLength: 8000,
                description: 'Previous generation reranker, optimized for latency'
            }
        };
    }
}
