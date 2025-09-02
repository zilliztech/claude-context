import OpenAI from 'openai';
import { Embedding, EmbeddingVector } from './base-embedding';

export interface AzureOpenAIEmbeddingConfig {
    model: string;
    apiKey: string;
    endpoint: string; // Azure OpenAI endpoint URL
    apiVersion?: string; // Azure OpenAI API version
    deploymentName?: string; // Azure OpenAI deployment name (optional, can use model name)
    codeAgentEmbEndpoint: string; // CodeAgent embedding endpoint
}

class BatchSemaphore {
    private static count = 0;
    private static readonly max = 5;
    static async acquire() {
        while (BatchSemaphore.count >= BatchSemaphore.max) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        BatchSemaphore.count++;
    }
    static release() {
        BatchSemaphore.count = Math.max(0, BatchSemaphore.count - 1);
    }
}

export class AzureOpenAIEmbedding extends Embedding {
    private client: OpenAI;
    private config: AzureOpenAIEmbeddingConfig;
    private dimension: number = 1536; // Default dimension for text-embedding-3-small
    protected maxTokens: number = 8192; // Maximum tokens for Azure OpenAI embedding models

    constructor(config: AzureOpenAIEmbeddingConfig) {
        super();
        this.config = config;

        // Construct the base URL for Azure OpenAI
        const baseURL = `${config.endpoint}/openai/deployments/${config.deploymentName || config.model}`;

        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: baseURL,
            defaultQuery: {
                'api-version': config.apiVersion || '2024-02-15-preview'
            }
        });
    }

    async detectDimension(testText: string = "test"): Promise<number> {
        const model = this.config.model || 'text-embedding-3-small';
        const knownModels = AzureOpenAIEmbedding.getSupportedModels();

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
            return response.data[0].embedding.length;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            // Re-throw authentication errors
            if (errorMessage.includes('API key') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
                throw new Error(`Failed to detect dimension for Azure OpenAI model ${model}: ${errorMessage}`);
            }

            // For other errors, throw exception instead of using fallback
            throw new Error(`Failed to detect dimension for Azure OpenAI model ${model}: ${errorMessage}`);
        }
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const processedText = this.preprocessText(text);
        const model = this.config.model || 'text-embedding-3-small';

        const knownModels = AzureOpenAIEmbedding.getSupportedModels();
        if (knownModels[model] && this.dimension !== knownModels[model].dimension) {
            this.dimension = knownModels[model].dimension;
        } else if (!knownModels[model]) {
            this.dimension = await this.detectDimension();
        }

        try {
            const response = await fetch(`${this.config.codeAgentEmbEndpoint}/get_embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify([{ code: processedText }])
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
            }

            const base64Response = await response.text();
            const processedEmbeddings = this.getEmbeddingVector(base64Response);

            if (processedEmbeddings.length !== 1) {
                throw new Error(`Mismatch between expected embeddings (1) and received embeddings (${processedEmbeddings.length})`);
            }

            return {
                vector: processedEmbeddings[0].vector,
                dimension: processedEmbeddings[0].dimension
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to generate Azure OpenAI embedding: ${errorMessage}`);
        }
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        // Return mock embeddings for testing
        const processedTexts = this.preprocessTexts(texts);
        const model = this.config.model || 'text-embedding-3-small';

        const knownModels = AzureOpenAIEmbedding.getSupportedModels();
        if (knownModels[model] && this.dimension !== knownModels[model].dimension) {
            this.dimension = knownModels[model].dimension;
        } else if (!knownModels[model]) {
            this.dimension = await this.detectDimension();
        }

        const jsonTexts = processedTexts.map(text => ({
            code: text
        }));

        // Send HTTP POST request to local embeddings endpoint
        await BatchSemaphore.acquire();
        try {
            const response = await fetch(`${this.config.codeAgentEmbEndpoint}/get_embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(jsonTexts)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Get the base64 response string
            const base64Response = await response.text();
            const processedEmbeddings = this.getEmbeddingVector(base64Response);
            if (processedEmbeddings.length !== processedTexts.length) {
                throw new Error(`Mismatch between expected embeddings (${processedTexts.length}) and received embeddings (${processedEmbeddings.length})`);
            }

            // console.log(`[embedBatch][${new Date().toLocaleString()}] Processed Embeddings: ${JSON.stringify(processedEmbeddings[0])}`);
            return processedEmbeddings;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to get embeddings from local endpoint: ${errorMessage}`);
        } finally {
            BatchSemaphore.release();
        }
    }

    getEmbeddingVector(base64Response: string): EmbeddingVector[] {
        // Decode base64 string to byte array
        const byteArray = Buffer.from(base64Response, 'base64');
        // Calculate the size of each embedding section
        const embeddingSize = 3072 * 4; // 3072 floats * 4 bytes per float
        const numEmbeddings = Math.floor(byteArray.length / embeddingSize);



        const processedEmbeddings: EmbeddingVector[] = [];

        for (let i = 0; i < numEmbeddings; i++) {
            const startIndex = i * embeddingSize;
            const endIndex = startIndex + embeddingSize;
            const embeddingBytes = byteArray.slice(startIndex, endIndex);

            const vector: number[] = [];

            // Convert every 4 bytes into a float
            for (let j = 0; j < embeddingBytes.length; j += 4) {
                const floatBytes = embeddingBytes.slice(j, j + 4);
                const floatValue = floatBytes.readFloatLE(0); // Read as little-endian float
                vector.push(floatValue);
            }

            processedEmbeddings.push({
                vector: vector,
                dimension: 3072
            });
        }
        return processedEmbeddings;
    }

    getDimension(): number {
        // For custom models, we need to detect the dimension first
        const model = this.config.model || 'text-embedding-3-small';
        const knownModels = AzureOpenAIEmbedding.getSupportedModels();

        // If it's a known model, return its known dimension
        if (knownModels[model]) {
            return knownModels[model].dimension;
        }

        // For custom models, return the current dimension
        // Note: This may be incorrect until detectDimension() is called
        console.warn(`[AzureOpenAIEmbedding] getDimension() called for custom model '${model}' - returning ${this.dimension}. Call detectDimension() first for accurate dimension.`);
        return this.dimension;
    }

    getProvider(): string {
        return 'Azure OpenAI';
    }

    /**
     * Set model type
     * @param model Model name
     */
    async setModel(model: string): Promise<void> {
        this.config.model = model;
        const knownModels = AzureOpenAIEmbedding.getSupportedModels();
        if (knownModels[model]) {
            this.dimension = knownModels[model].dimension;
        } else {
            this.dimension = await this.detectDimension();
        }
    }

    /**
     * Set deployment name (Azure OpenAI specific)
     * @param deploymentName Deployment name
     */
    setDeploymentName(deploymentName: string): void {
        this.config.deploymentName = deploymentName;
        // Recreate client with new deployment name
        const baseURL = `${this.config.endpoint}/openai/deployments/${deploymentName}`;
        this.client = new OpenAI({
            apiKey: this.config.apiKey,
            baseURL: baseURL,
            defaultQuery: {
                'api-version': this.config.apiVersion || '2024-02-15-preview'
            }
        });
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