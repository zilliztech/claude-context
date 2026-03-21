import { Embedding, EmbeddingVector } from './base-embedding';

export interface MiniMaxEmbeddingConfig {
    apiKey: string;
    model?: string;
    baseURL?: string;
    /** Embedding type: 'db' for storage/indexing, 'query' for search queries */
    type?: 'db' | 'query';
}

interface MiniMaxEmbeddingResponse {
    vectors: number[][];
    total_tokens: number;
    base_resp: {
        status_code: number;
        status_msg: string;
    };
}

export class MiniMaxEmbedding extends Embedding {
    private config: MiniMaxEmbeddingConfig;
    private dimension: number = 1536; // embo-01 outputs 1536 dimensions
    protected maxTokens: number = 4096; // MiniMax embedding token limit

    constructor(config: MiniMaxEmbeddingConfig) {
        super();
        this.config = {
            model: 'embo-01',
            baseURL: 'https://api.minimax.io/v1',
            type: 'db',
            ...config,
        };
    }

    async detectDimension(testText: string = "test"): Promise<number> {
        const model = this.config.model || 'embo-01';
        const knownModels = MiniMaxEmbedding.getSupportedModels();

        if (knownModels[model]) {
            return knownModels[model].dimension;
        }

        // For unknown models, make API call to detect dimension
        try {
            const processedText = this.preprocessText(testText);
            const response = await this.callApi([processedText]);
            return response.vectors[0].length;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to detect dimension for model ${model}: ${errorMessage}`);
        }
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const processedText = this.preprocessText(text);

        try {
            const response = await this.callApi([processedText]);
            this.dimension = response.vectors[0].length;

            return {
                vector: response.vectors[0],
                dimension: this.dimension
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to generate MiniMax embedding: ${errorMessage}`);
        }
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const processedTexts = this.preprocessTexts(texts);

        try {
            const response = await this.callApi(processedTexts);
            this.dimension = response.vectors[0].length;

            return response.vectors.map((vector) => ({
                vector,
                dimension: this.dimension
            }));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to generate MiniMax batch embeddings: ${errorMessage}`);
        }
    }

    getDimension(): number {
        const model = this.config.model || 'embo-01';
        const knownModels = MiniMaxEmbedding.getSupportedModels();

        if (knownModels[model]) {
            return knownModels[model].dimension;
        }

        return this.dimension;
    }

    getProvider(): string {
        return 'MiniMax';
    }

    /**
     * Set model type
     * @param model Model name
     */
    async setModel(model: string): Promise<void> {
        this.config.model = model;
        const knownModels = MiniMaxEmbedding.getSupportedModels();
        if (knownModels[model]) {
            this.dimension = knownModels[model].dimension;
        } else {
            this.dimension = await this.detectDimension();
        }
    }

    /**
     * Set embedding type
     * @param type 'db' for storage/indexing, 'query' for search queries
     */
    setType(type: 'db' | 'query'): void {
        this.config.type = type;
    }

    /**
     * Get list of supported models
     */
    static getSupportedModels(): Record<string, { dimension: number; description: string }> {
        return {
            'embo-01': {
                dimension: 1536,
                description: 'MiniMax general-purpose embedding model (1536 dimensions)'
            }
        };
    }

    private async callApi(texts: string[]): Promise<MiniMaxEmbeddingResponse> {
        const url = `${this.config.baseURL}/embeddings`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
                model: this.config.model || 'embo-01',
                texts,
                type: this.config.type || 'db',
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`MiniMax API error (${response.status}): ${errorBody}`);
        }

        const data = await response.json() as MiniMaxEmbeddingResponse;

        if (data.base_resp && data.base_resp.status_code !== 0) {
            throw new Error(`MiniMax API error: ${data.base_resp.status_msg}`);
        }

        return data;
    }
}
