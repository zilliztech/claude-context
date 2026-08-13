import { GoogleGenAI } from '@google/genai';
import { Embedding, EmbeddingVector } from './base-embedding';

type GeminiModelInfo = {
    dimension: number;
    contextLength: number;
    description: string;
    supportedDimensions?: number[];
};

export interface GeminiEmbeddingConfig {
    model: string;
    apiKey: string;
    baseURL?: string; // Optional custom API endpoint URL
    outputDimensionality?: number; // Optional dimension override
}

export class GeminiEmbedding extends Embedding {
    private client: GoogleGenAI;
    private config: GeminiEmbeddingConfig;
    private dimension: number = 3072; // Default dimension for Gemini embedding models
    protected maxTokens: number = 2048; // Maximum tokens for Gemini embedding models

    constructor(config: GeminiEmbeddingConfig) {
        super();
        this.config = config;
        this.client = new GoogleGenAI({
            apiKey: config.apiKey,
            ...(config.baseURL && {
                httpOptions: {
                    baseUrl: config.baseURL
                }
            }),
        });

        // Set dimension based on model and configuration
        this.updateDimensionForModel(config.model || 'gemini-embedding-001');

        // Override dimension if specified in config
        if (config.outputDimensionality) {
            this.dimension = config.outputDimensionality;
        }
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

    async detectDimension(): Promise<number> {
        // Gemini doesn't need dynamic detection, return configured dimension
        return this.dimension;
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const processedText = this.preprocessText(text);
        const model = this.config.model || 'gemini-embedding-001';

        try {
            return await this.embedProcessedText(processedText, model);
        } catch (error) {
            throw new Error(`Gemini embedding failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        if (texts.length === 0) {
            return [];
        }

        const processedTexts = this.preprocessTexts(texts);
        const model = this.config.model || 'gemini-embedding-001';

        try {
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

            if (response.embeddings.length !== processedTexts.length) {
                throw new Error(`Gemini API returned ${response.embeddings.length} embeddings for ${processedTexts.length} inputs`);
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
            throw new Error(`Gemini batch embedding failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async embedProcessedText(processedText: string, model: string): Promise<EmbeddingVector> {
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
     * Get client instance (for advanced usage)
     */
    getClient(): GoogleGenAI {
        return this.client;
    }

    /**
     * Get list of supported models
     */
    static getSupportedModels(): Record<string, GeminiModelInfo> {
        return {
            'gemini-embedding-001': {
                dimension: 3072,
                contextLength: 2048,
                description: 'Gemini embedding model with state-of-the-art performance',
                supportedDimensions: [3072, 1536, 768, 256] // Matryoshka Representation Learning support
            },
            'gemini-embedding-2': {
                dimension: 3072,
                contextLength: 8192,
                description: 'Gemini Embedding 2 model with improved embedding quality and longer context',
                supportedDimensions: [3072, 1536, 768, 256]
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
