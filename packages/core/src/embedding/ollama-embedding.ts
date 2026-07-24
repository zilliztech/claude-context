import { Ollama } from 'ollama';
import { Embedding, EmbeddingVector } from './base-embedding';

// Per-request embed timeout. A single chunk embed on a CPU embedder finishes in
// well under this; without a bound, one request that never returns (e.g. a
// pathological minified/single-line bundle) hangs indexing forever with no
// self-recovery. AbortSignal.timeout cancels the socket so the request rejects
// instead of wedging. Override via OLLAMA_EMBED_TIMEOUT_MS.
const EMBED_REQUEST_TIMEOUT_MS = Number(process.env.OLLAMA_EMBED_TIMEOUT_MS) || 120_000;
// Bounded retries for TRANSIENT failures only (connection reset, 5xx). A timeout
// is deterministic for a given input, so it is never retried — we fail fast and
// let the caller drop/skip. Override via OLLAMA_EMBED_MAX_ATTEMPTS.
const EMBED_MAX_ATTEMPTS = Number(process.env.OLLAMA_EMBED_MAX_ATTEMPTS) || 2;
const EMBED_RETRY_DELAY_MS = 1_000;

export interface OllamaEmbeddingConfig {
    model: string;
    host?: string;
    fetch?: any;
    keepAlive?: string | number;
    options?: Record<string, any>;
    dimension?: number; // Optional dimension parameter
    maxTokens?: number; // Optional max tokens parameter
}

export class OllamaEmbedding extends Embedding {
    private client: Ollama;
    private config: OllamaEmbeddingConfig;
    private dimension: number = 768; // Default dimension for many embedding models
    private dimensionDetected: boolean = false; // Track if dimension has been detected
    protected maxTokens: number = 2048; // Default context window for Ollama

    constructor(config: OllamaEmbeddingConfig) {
        super();
        this.config = config;
        this.client = this.makeClient(config.host || 'http://127.0.0.1:11434');

        // Set dimension based on config or will be detected on first use
        if (config.dimension) {
            this.dimension = config.dimension;
            this.dimensionDetected = true;
        }

        // Set max tokens based on config or use default
        if (config.maxTokens) {
            this.maxTokens = config.maxTokens;
        } else {
            // Set default based on known models
            this.setDefaultMaxTokensForModel(config.model);
        }

        // If no dimension is provided, it will be detected in the first embed call
    }

    /**
     * Build an Ollama client whose requests are bounded by EMBED_REQUEST_TIMEOUT_MS.
     * The Ollama SDK has no per-request timeout, so we inject a fetch that attaches
     * an AbortSignal.timeout — a hung embed then rejects (and is caught upstream)
     * instead of wedging indexing forever. A caller-provided signal is respected.
     */
    private makeClient(host: string): Ollama {
        const providedFetch = this.config.fetch;
        const timeoutFetch = (input: any, init: any = {}) => {
            const signal = init?.signal ?? AbortSignal.timeout(EMBED_REQUEST_TIMEOUT_MS);
            return (providedFetch ?? fetch)(input, { ...init, signal });
        };
        return new Ollama({ host, fetch: timeoutFetch });
    }

    /**
     * Run a single embed request with a bounded per-request timeout (via the
     * client's timeout fetch) and retry only transient failures. A timeout is
     * deterministic for a given input, so it is never retried: we throw so the
     * caller drops the batch rather than looping on a request that will hang again.
     */
    private async embedWithRetry(embedOptions: any): Promise<any> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= EMBED_MAX_ATTEMPTS; attempt++) {
            try {
                return await this.client.embed(embedOptions);
            } catch (error) {
                lastError = error;
                const name = (error as { name?: string })?.name;
                const message = error instanceof Error ? error.message : String(error);
                const isTimeout = name === 'TimeoutError' || name === 'AbortError';
                console.error(`[OllamaEmbedding] embed attempt ${attempt}/${EMBED_MAX_ATTEMPTS} failed (${name || 'Error'}): ${message}`);
                if (isTimeout || attempt >= EMBED_MAX_ATTEMPTS) break;
                await new Promise(resolve => setTimeout(resolve, EMBED_RETRY_DELAY_MS));
            }
        }
        throw lastError;
    }

    private setDefaultMaxTokensForModel(model: string): void {
        // Set different max tokens based on known models
        if (model?.includes('nomic-embed-text')) {
            this.maxTokens = 8192; // nomic-embed-text supports 8192 tokens
        } else if (model?.includes('snowflake-arctic-embed')) {
            this.maxTokens = 8192; // snowflake-arctic-embed supports 8192 tokens
        } else {
            this.maxTokens = 2048; // Default for most Ollama models
        }
    }

    async embed(text: string): Promise<EmbeddingVector> {
        // Preprocess the text
        const processedText = this.preprocessText(text);

        // Detect dimension on first use if not configured
        if (!this.dimensionDetected && !this.config.dimension) {
            this.dimension = await this.detectDimension();
            this.dimensionDetected = true;
            console.log(`[OllamaEmbedding] 📏 Detected Ollama embedding dimension: ${this.dimension} for model: ${this.config.model}`);
        }

        const embedOptions: any = {
            model: this.config.model,
            input: processedText,
            options: this.config.options,
        };

        // Only include keep_alive if it has a valid value
        if (this.config.keepAlive && this.config.keepAlive !== '') {
            embedOptions.keep_alive = this.config.keepAlive;
        }

        const response = await this.embedWithRetry(embedOptions);

        if (!response.embeddings || !response.embeddings[0]) {
            throw new Error('Ollama API returned invalid response');
        }

        return {
            vector: response.embeddings[0],
            dimension: this.dimension
        };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        // Preprocess all texts
        const processedTexts = this.preprocessTexts(texts);

        // Detect dimension on first use if not configured
        if (!this.dimensionDetected && !this.config.dimension) {
            this.dimension = await this.detectDimension();
            this.dimensionDetected = true;
            console.log(`[OllamaEmbedding] 📏 Detected Ollama embedding dimension: ${this.dimension} for model: ${this.config.model}`);
        }

        // Use Ollama's native batch embedding API
        const embedOptions: any = {
            model: this.config.model,
            input: processedTexts, // Pass array directly to Ollama
            options: this.config.options,
        };

        // Only include keep_alive if it has a valid value
        if (this.config.keepAlive && this.config.keepAlive !== '') {
            embedOptions.keep_alive = this.config.keepAlive;
        }

        const response = await this.embedWithRetry(embedOptions);

        if (!response.embeddings || !Array.isArray(response.embeddings)) {
            throw new Error('Ollama API returned invalid batch response');
        }

        // Convert to EmbeddingVector format
        return response.embeddings.map((embedding: number[]) => ({
            vector: embedding,
            dimension: this.dimension
        }));
    }

    getDimension(): number {
        return this.dimension;
    }

    getProvider(): string {
        return 'Ollama';
    }

    getModelIdentifier(): string {
        return `${this.getProvider()}:${this.config.model}`;
    }

    /**
     * Set model type and detect its dimension
     * @param model Model name
     */
    async setModel(model: string): Promise<void> {
        this.config.model = model;
        // Reset dimension detection when model changes
        this.dimensionDetected = false;
        // Update max tokens for new model
        this.setDefaultMaxTokensForModel(model);
        if (!this.config.dimension) {
            this.dimension = await this.detectDimension();
            this.dimensionDetected = true;
            console.log(`[OllamaEmbedding] 📏 Detected Ollama embedding dimension: ${this.dimension} for model: ${this.config.model}`);
        } else {
            console.log('[OllamaEmbedding] Dimension already detected for model ' + this.config.model);
        }
    }

    /**
     * Set host URL
     * @param host Ollama host URL
     */
    setHost(host: string): void {
        this.config.host = host;
        this.client = this.makeClient(host);
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
     * Set max tokens manually
     * @param maxTokens Maximum number of tokens
     */
    setMaxTokens(maxTokens: number): void {
        this.config.maxTokens = maxTokens;
        this.maxTokens = maxTokens;
    }

    /**
     * Get client instance (for advanced usage)
     */
    getClient(): Ollama {
        return this.client;
    }

    async detectDimension(testText: string = "test"): Promise<number> {
        console.log(`[OllamaEmbedding] Detecting embedding dimension...`);

        try {
            const processedText = this.preprocessText(testText);
            const embedOptions: any = {
                model: this.config.model,
                input: processedText,
                options: this.config.options,
            };

            if (this.config.keepAlive && this.config.keepAlive !== '') {
                embedOptions.keep_alive = this.config.keepAlive;
            }

            const response = await this.embedWithRetry(embedOptions);

            if (!response.embeddings || !response.embeddings[0]) {
                throw new Error('Ollama API returned invalid response');
            }

            const dimension = response.embeddings[0].length;
            console.log(`[OllamaEmbedding] Successfully detected embedding dimension: ${dimension}`);
            return dimension;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[OllamaEmbedding] Failed to detect dimension: ${errorMessage}`);
            throw new Error(`Failed to detect Ollama embedding dimension: ${errorMessage}`);
        }
    }
}