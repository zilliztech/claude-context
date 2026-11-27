import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Embedding, EmbeddingVector } from './base-embedding';

type BedrockModelFamily = 'titan' | 'cohere';

type BedrockModelInfo = {
    dimension: number;
    maxTokens: number;
    family: BedrockModelFamily;
    description: string;
    supportedDimensions?: number[];
};

export interface BedrockEmbeddingConfig {
    model: string;
    region: string;
    // Optional static credentials. When omitted, the AWS SDK's default
    // credential provider chain is used (env vars, shared config, IAM role, etc).
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    // Optional custom endpoint, e.g. a VPC interface endpoint for Bedrock Runtime.
    endpoint?: string;
    // Optional dimension override (only honored by amazon.titan-embed-text-v2:0).
    dimension?: number;
}

// Cohere Embed models on Bedrock accept at most 96 texts per InvokeModel call.
const COHERE_BATCH_LIMIT = 96;

export class BedrockEmbedding extends Embedding {
    private client: BedrockRuntimeClient;
    private config: BedrockEmbeddingConfig;
    private dimension: number;
    protected maxTokens: number;

    constructor(config: BedrockEmbeddingConfig) {
        super();
        this.config = config;
        this.client = new BedrockRuntimeClient({
            region: config.region,
            ...(config.endpoint && { endpoint: config.endpoint }),
            ...(config.accessKeyId && config.secretAccessKey && {
                credentials: {
                    accessKeyId: config.accessKeyId,
                    secretAccessKey: config.secretAccessKey,
                    ...(config.sessionToken && { sessionToken: config.sessionToken })
                }
            })
        });

        const model = config.model || 'amazon.titan-embed-text-v2:0';
        const modelInfo = BedrockEmbedding.getSupportedModels()[model];
        this.dimension = config.dimension || modelInfo?.dimension || 1024;
        this.maxTokens = modelInfo?.maxTokens || 8192;
    }

    async detectDimension(): Promise<number> {
        // Bedrock embedding dimensions are known per-model, no dynamic detection needed.
        return this.dimension;
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const [result] = await this.embedBatch([text]);
        return result;
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        if (texts.length === 0) {
            return [];
        }

        const processedTexts = this.preprocessTexts(texts);
        const model = this.config.model || 'amazon.titan-embed-text-v2:0';
        const family = this.getModelFamily(model);

        if (family === 'cohere') {
            return this.embedCohereBatch(processedTexts, model);
        }

        // Titan embedding models only accept a single inputText per InvokeModel call.
        const results: EmbeddingVector[] = [];
        for (const text of processedTexts) {
            results.push(await this.embedTitanSingle(text, model));
        }
        return results;
    }

    private getModelFamily(model: string): BedrockModelFamily {
        return model.startsWith('cohere.') ? 'cohere' : 'titan';
    }

    private async embedTitanSingle(text: string, model: string): Promise<EmbeddingVector> {
        const body: Record<string, unknown> = { inputText: text };
        if (model.includes('titan-embed-text-v2')) {
            body.dimensions = this.dimension;
            body.normalize = true;
        }

        const response = await this.invoke(model, body);
        if (!Array.isArray(response.embedding)) {
            throw new Error(`Bedrock model ${model} returned a response with no "embedding" field`);
        }

        return {
            vector: response.embedding,
            dimension: response.embedding.length
        };
    }

    private async embedCohereBatch(texts: string[], model: string): Promise<EmbeddingVector[]> {
        const results: EmbeddingVector[] = [];
        for (let i = 0; i < texts.length; i += COHERE_BATCH_LIMIT) {
            const chunk = texts.slice(i, i + COHERE_BATCH_LIMIT);
            const response = await this.invoke(model, {
                texts: chunk,
                input_type: 'search_document'
            });

            if (!Array.isArray(response.embeddings)) {
                throw new Error(`Bedrock model ${model} returned a response with no "embeddings" field`);
            }

            for (const embedding of response.embeddings) {
                results.push({ vector: embedding, dimension: embedding.length });
            }
        }
        return results;
    }

    private async invoke(model: string, body: Record<string, unknown>): Promise<any> {
        try {
            const command = new InvokeModelCommand({
                modelId: model,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(body)
            });
            const response = await this.client.send(command);
            const raw = await response.body?.transformToString();
            if (!raw) {
                throw new Error('Bedrock returned an empty response body');
            }
            return JSON.parse(raw);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Bedrock embedding failed for model ${model}: ${errorMessage}`);
        }
    }

    getDimension(): number {
        return this.dimension;
    }

    getProvider(): string {
        return 'Bedrock';
    }

    /**
     * Set model type
     * @param model Bedrock model ID
     */
    setModel(model: string): void {
        this.config.model = model;
        const modelInfo = BedrockEmbedding.getSupportedModels()[model];
        this.dimension = this.config.dimension || modelInfo?.dimension || 1024;
        this.maxTokens = modelInfo?.maxTokens || 8192;
    }

    /**
     * Get client instance (for advanced usage)
     */
    getClient(): BedrockRuntimeClient {
        return this.client;
    }

    /**
     * Get list of supported models
     */
    static getSupportedModels(): Record<string, BedrockModelInfo> {
        return {
            'amazon.titan-embed-text-v2:0': {
                dimension: 1024,
                maxTokens: 8192,
                family: 'titan',
                description: 'Titan Text Embeddings V2 (recommended; supports 256/512/1024 dims)',
                supportedDimensions: [256, 512, 1024]
            },
            'amazon.titan-embed-text-v1': {
                dimension: 1536,
                maxTokens: 8192,
                family: 'titan',
                description: 'Titan Text Embeddings V1 (legacy)'
            },
            'cohere.embed-english-v3': {
                dimension: 1024,
                maxTokens: 512,
                family: 'cohere',
                description: 'Cohere Embed English V3'
            },
            'cohere.embed-multilingual-v3': {
                dimension: 1024,
                maxTokens: 512,
                family: 'cohere',
                description: 'Cohere Embed Multilingual V3'
            }
        };
    }
}
