import { VoyageAIClient } from 'voyageai';
import { Embedding, EmbeddingVector } from './base-embedding';

export interface VoyageAIEmbeddingConfig {
    model: string;
    apiKey: string;
}

export class VoyageAIEmbedding extends Embedding {
    private client: VoyageAIClient;
    private config: VoyageAIEmbeddingConfig;
    private dimension: number = 1024; // Default dimension for voyage-code-3
    private inputType: 'document' | 'query' = 'document';
    protected maxTokens: number = 32000; // Default max tokens

    constructor(config: VoyageAIEmbeddingConfig) {
        super();
        this.config = config;
        this.client = new VoyageAIClient({
            apiKey: config.apiKey,
        });

        // Set dimension and context length based on different models
        this.updateModelSettings(config.model || 'voyage-code-3');
    }

    private updateModelSettings(model: string): void {
        const supportedModels = VoyageAIEmbedding.getSupportedModels();
        const modelInfo = supportedModels[model];

        if (modelInfo) {
            // If dimension is a string (indicating variable dimension), use default value 1024
            if (typeof modelInfo.dimension === 'string') {
                this.dimension = 1024; // Default dimension
            } else {
                this.dimension = modelInfo.dimension;
            }
            // Set max tokens based on model's context length
            this.maxTokens = modelInfo.contextLength;
        } else {
            // Use default dimension and context length for unknown models
            this.dimension = 1024;
            this.maxTokens = 32000;
        }
    }

    private updateDimensionForModel(model: string): void {
        const supportedModels = VoyageAIEmbedding.getSupportedModels();
        const modelInfo = supportedModels[model];

        if (modelInfo) {
            // If dimension is a string (indicating variable dimension), use default value 1024
            if (typeof modelInfo.dimension === 'string') {
                this.dimension = 1024; // Default dimension
            } else {
                this.dimension = modelInfo.dimension;
            }
        } else {
            // Use default dimension for unknown models
            this.dimension = 1024;
        }
    }

    async detectDimension(): Promise<number> {
        // VoyageAI doesn't need dynamic detection, return configured dimension
        return this.dimension;
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const processedText = this.preprocessText(text);
        const model = this.config.model || 'voyage-code-3';

        const response = await this.client.embed({
            input: processedText,
            model: model,
            inputType: this.inputType,
        });

        if (!response.data || !response.data[0] || !response.data[0].embedding) {
            throw new Error('VoyageAI API returned invalid response');
        }

        return {
            vector: response.data[0].embedding,
            dimension: this.dimension
        };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const processedTexts = this.preprocessTexts(texts);
        const model = this.config.model || 'voyage-code-3';

        const response = await this.client.embed({
            input: processedTexts,
            model: model,
            inputType: this.inputType,
        });

        if (!response.data) {
            throw new Error('VoyageAI API returned invalid response');
        }

        return response.data.map((item) => {
            if (!item.embedding) {
                throw new Error('VoyageAI API returned invalid embedding data');
            }
            return {
                vector: item.embedding,
                dimension: this.dimension
            };
        });
    }

    getDimension(): number {
        return this.dimension;
    }

    getProvider(): string {
        return 'VoyageAI';
    }

    /**
     * Set model type
     * @param model Model name
     */
    setModel(model: string): void {
        this.config.model = model;
        this.updateModelSettings(model);
    }

    /**
     * Set input type (VoyageAI specific feature)
     * @param inputType Input type: 'document' | 'query'
     */
    setInputType(inputType: 'document' | 'query'): void {
        this.inputType = inputType;
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
    static getSupportedModels(): Record<string, { dimension: number | string; contextLength: number; description: string }> {
        return {
            // Latest recommended models
            'voyage-3-large': {
                dimension: '1024 (default), 256, 512, 2048',
                contextLength: 32000,
                description: 'The best general-purpose and multilingual retrieval quality'
            },
            'voyage-3.5': {
                dimension: '1024 (default), 256, 512, 2048',
                contextLength: 32000,
                description: 'Optimized for general-purpose and multilingual retrieval quality'
            },
            'voyage-3.5-lite': {
                dimension: '1024 (default), 256, 512, 2048',
                contextLength: 32000,
                description: 'Optimized for latency and cost'
            },
            'voyage-code-3': {
                dimension: '1024 (default), 256, 512, 2048',
                contextLength: 32000,
                description: 'Optimized for code retrieval (recommended for code)'
            },
            // Professional domain models
            'voyage-finance-2': {
                dimension: 1024,
                contextLength: 32000,
                description: 'Optimized for finance retrieval and RAG'
            },
            'voyage-law-2': {
                dimension: 1024,
                contextLength: 16000,
                description: 'Optimized for legal retrieval and RAG'
            },
            'voyage-multilingual-2': {
                dimension: 1024,
                contextLength: 32000,
                description: 'Legacy: Use voyage-3.5 for multilingual tasks'
            },
            'voyage-large-2-instruct': {
                dimension: 1024,
                contextLength: 16000,
                description: 'Legacy: Use voyage-3.5 instead'
            },
            // Legacy models
            'voyage-large-2': {
                dimension: 1536,
                contextLength: 16000,
                description: 'Legacy: Use voyage-3.5 instead'
            },
            'voyage-code-2': {
                dimension: 1536,
                contextLength: 16000,
                description: 'Previous generation of code embeddings'
            },
            'voyage-3': {
                dimension: 1024,
                contextLength: 32000,
                description: 'Legacy: Use voyage-3.5 instead'
            },
            'voyage-3-lite': {
                dimension: 512,
                contextLength: 32000,
                description: 'Legacy: Use voyage-3.5-lite instead'
            },
            'voyage-2': {
                dimension: 1024,
                contextLength: 4000,
                description: 'Legacy: Use voyage-3.5-lite instead'
            },
            // Other legacy models
            'voyage-02': {
                dimension: 1024,
                contextLength: 4000,
                description: 'Legacy model'
            },
            'voyage-01': {
                dimension: 1024,
                contextLength: 4000,
                description: 'Legacy model'
            },
            'voyage-lite-01': {
                dimension: 1024,
                contextLength: 4000,
                description: 'Legacy model'
            },
            'voyage-lite-01-instruct': {
                dimension: 1024,
                contextLength: 4000,
                description: 'Legacy model'
            },
            'voyage-lite-02-instruct': {
                dimension: 1024,
                contextLength: 4000,
                description: 'Legacy model'
            }
        };
    }
} 