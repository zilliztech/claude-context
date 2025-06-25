import { Ollama } from 'ollama';
import { Embedding, EmbeddingVector } from './index';

export interface OllamaEmbeddingConfig {
    model: string;
    host?: string;
    fetch?: any;
    keepAlive?: string | number;
    options?: Record<string, any>;
    dimension?: number; // Optional dimension parameter
}

export class OllamaEmbedding implements Embedding {
    private client: Ollama;
    private config: OllamaEmbeddingConfig;
    private dimension: number = 768; // Default dimension for many embedding models
    private dimensionDetected: boolean = false; // Track if dimension has been detected

    constructor(config: OllamaEmbeddingConfig) {
        this.config = config;
        this.client = new Ollama({
            host: config.host || 'http://127.0.0.1:11434',
            fetch: config.fetch,
        });

        // Set dimension based on config or will be detected on first use
        if (config.dimension) {
            this.dimension = config.dimension;
            this.dimensionDetected = true;
        }
        // If no dimension is provided, it will be detected in the first embed call
    }

    private async updateDimensionForModel(model: string): Promise<void> {
        try {
            // Use a dummy query to detect embedding dimension
            const embedOptions: any = {
                model: model,
                input: 'test',
                options: this.config.options,
            };

            // Only include keep_alive if it has a valid value
            if (this.config.keepAlive && this.config.keepAlive !== '') {
                embedOptions.keep_alive = this.config.keepAlive;
            }

            const response = await this.client.embed(embedOptions);

            if (response.embeddings && response.embeddings[0]) {
                this.dimension = response.embeddings[0].length;
                this.dimensionDetected = true;
                console.log(`📏 Detected embedding dimension: ${this.dimension} for model: ${model}`);
            } else {
                // Fallback to default dimension
                this.dimension = 768;
                this.dimensionDetected = true;
                console.warn(`⚠️  Could not detect dimension for model ${model}, using default: 768`);
            }
        } catch (error) {
            console.warn(`Failed to detect dimension for model ${model}, using default dimension 768:`, error);
            this.dimension = 768;
            this.dimensionDetected = true;
        }
    }

    async embed(text: string): Promise<EmbeddingVector> {
        // Detect dimension on first use if not configured
        if (!this.dimensionDetected) {
            await this.updateDimensionForModel(this.config.model);
        }

        const embedOptions: any = {
            model: this.config.model,
            input: text,
            options: this.config.options,
        };

        // Only include keep_alive if it has a valid value
        if (this.config.keepAlive && this.config.keepAlive !== '') {
            embedOptions.keep_alive = this.config.keepAlive;
        }

        const response = await this.client.embed(embedOptions);

        if (!response.embeddings || !response.embeddings[0]) {
            throw new Error('Ollama API returned invalid response');
        }

        return {
            vector: response.embeddings[0],
            dimension: this.dimension
        };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const results: EmbeddingVector[] = [];

        // Process texts in batches to avoid overwhelming the API
        const batchSize = 10;
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const batchPromises = batch.map(text => this.embed(text));
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        return results;
    }

    getDimension(): number {
        return this.dimension;
    }

    getProvider(): string {
        return 'Ollama';
    }

    /**
     * Set model type and detect its dimension
     * @param model Model name
     */
    async setModel(model: string): Promise<void> {
        this.config.model = model;
        // Reset dimension detection when model changes
        this.dimensionDetected = false;
        if (!this.config.dimension) {
            await this.updateDimensionForModel(model);
        }
    }

    /**
     * Set host URL
     * @param host Ollama host URL
     */
    setHost(host: string): void {
        this.config.host = host;
        this.client = new Ollama({
            host: host,
            fetch: this.config.fetch,
        });
    }

    /**
     * Set keep alive duration
     * @param keepAlive Keep alive duration
     */
    setKeepAlive(keepAlive: string | number): void {
        this.config.keepAlive = keepAlive;
    }

    /**
     * Set additional options
     * @param options Additional options for the model
     */
    setOptions(options: Record<string, any>): void {
        this.config.options = options;
    }

    /**
     * Set dimension manually
     * @param dimension Embedding dimension
     */
    setDimension(dimension: number): void {
        this.config.dimension = dimension;
        this.dimension = dimension;
        this.dimensionDetected = true;
    }

    /**
     * Get client instance (for advanced usage)
     */
    getClient(): Ollama {
        return this.client;
    }

    /**
     * Initialize dimension detection for the current model
     */
    async initializeDimension(): Promise<void> {
        if (!this.config.dimension) {
            await this.updateDimensionForModel(this.config.model);
        }
    }

}