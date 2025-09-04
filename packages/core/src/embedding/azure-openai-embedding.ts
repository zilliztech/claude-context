import { Embedding, EmbeddingVector } from './base-embedding';

export interface AzureOpenAIEmbeddingConfig {
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
    private codeAgentEmbEndpoint: string = '';
    private dimension: number = 3072; // Default dimension for text-embedding-3-small
    protected maxTokens: number = 8192; // Maximum tokens for Azure OpenAI embedding models

    constructor(config: AzureOpenAIEmbeddingConfig) {
        super();
        this.codeAgentEmbEndpoint = config.codeAgentEmbEndpoint;
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const processedText = this.preprocessText(text);

        try {
            const response = await fetch(`${this.codeAgentEmbEndpoint}/get_embeddings`, {
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
        const jsonTexts = processedTexts.map(text => ({
            code: text
        }));

        // Send HTTP POST request to local embeddings endpoint
        await BatchSemaphore.acquire();
        try {
            const response = await fetch(`${this.codeAgentEmbEndpoint}/get_embeddings`, {
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
        const embeddingSize = this.dimension * 4; // 3072 floats * 4 bytes per float
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
                dimension: this.dimension
            });
        }
        return processedEmbeddings;
    }

    getProvider(): string {
        return 'Azure OpenAI';
    }

    getDimension(): number {
        return this.dimension;
    }

    async detectDimension(testText: string = "test"): Promise<number> {
        return this.dimension;
    }
}