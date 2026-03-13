import { Embedding, EmbeddingVector } from './base-embedding';

export interface LlamaCppEmbeddingConfig {
    host?: string;
    model?: string;
    codePrefix?: boolean; // Enable automatic code prefix
    dimension?: number; // Optional dimension parameter
    maxTokens?: number; // Optional max tokens parameter
    timeout?: number; // Request timeout in milliseconds
}

export class LlamaCppConfigurationError extends Error {
    constructor(message: string) {
        super(`LlamaCpp configuration error: ${message}`);
        this.name = 'LlamaCppConfigurationError';
    }
}

export class LlamaCppNetworkError extends Error {
    constructor(message: string, public readonly originalError?: Error) {
        super(`LlamaCpp network error: ${message}`);
        this.name = 'LlamaCppNetworkError';
    }
}

export class LlamaCppEmbedding extends Embedding {
    private config: LlamaCppEmbeddingConfig;
    private dimension: number = 768; // Default dimension
    private dimensionDetected: boolean = false;
    protected maxTokens: number = 8192; // Default for code models like nomic-embed-code
    private host: string;
    private codePrefix: string = "Represent this query for searching relevant code:";

    constructor(config: LlamaCppEmbeddingConfig) {
        super();

        this.validateConfig(config);

        this.config = config;
        this.host = this.normalizeHost(config.host || 'http://localhost:8080');

        // Set dimension if provided
        if (config.dimension) {
            if (config.dimension <= 0) {
                throw new LlamaCppConfigurationError('Dimension must be a positive number');
            }
            this.dimension = config.dimension;
            this.dimensionDetected = true;
        }

        // Set max tokens if provided
        if (config.maxTokens) {
            if (config.maxTokens <= 0) {
                throw new LlamaCppConfigurationError('Max tokens must be a positive number');
            }
            this.maxTokens = config.maxTokens;
        }

        // Enable code prefix by default for llamacpp (designed for code)
        if (config.codePrefix === undefined) {
            this.config.codePrefix = true;
        }
    }

    private validateConfig(config: LlamaCppEmbeddingConfig): void {
        if (!config) {
            throw new LlamaCppConfigurationError('Configuration object is required');
        }

        if (config.host !== undefined && typeof config.host !== 'string') {
            throw new LlamaCppConfigurationError('Host must be a string');
        }

        if (config.model !== undefined && typeof config.model !== 'string') {
            throw new LlamaCppConfigurationError('Model must be a string');
        }

        if (config.timeout !== undefined && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
            throw new LlamaCppConfigurationError('Timeout must be a positive number');
        }

        if (config.host) {
            this.validateHostUrl(config.host);
        }
    }

    private validateHostUrl(host: string): void {
        try {
            const url = new URL(host);
            if (!['http:', 'https:'].includes(url.protocol)) {
                throw new LlamaCppConfigurationError(`Unsupported protocol: ${url.protocol}. Only HTTP and HTTPS are supported`);
            }
        } catch (error) {
            if (error instanceof LlamaCppConfigurationError) {
                throw error;
            }
            throw new LlamaCppConfigurationError(`Invalid host URL: ${host}`);
        }
    }

    private normalizeHost(host: string): string {
        // Remove trailing slash for consistency
        return host.replace(/\/$/, '');
    }

    private async makeRequest(url: string, body: any): Promise<any> {
        const timeout = this.config.timeout || 30000; // 30s default timeout

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            console.log(`[LlamaCppEmbedding] Making request to ${url} with timeout ${timeout}ms`);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorDetails: string;
                try {
                    errorDetails = await response.text();
                } catch {
                    errorDetails = 'Unable to read error response';
                }

                const errorMessage = `HTTP ${response.status} (${response.statusText}): ${errorDetails}`;
                console.error(`[LlamaCppEmbedding] Request failed: ${errorMessage}`);
                throw new LlamaCppNetworkError(errorMessage);
            }

            let responseData: any;
            try {
                responseData = await response.json();
            } catch (parseError) {
                const errorMessage = 'Invalid JSON response from server';
                console.error(`[LlamaCppEmbedding] ${errorMessage}:`, parseError);
                throw new LlamaCppNetworkError(errorMessage, parseError instanceof Error ? parseError : undefined);
            }

            return responseData;
        } catch (error) {
            clearTimeout(timeoutId);

            // Re-throw specific errors without wrapping
            if (error instanceof LlamaCppNetworkError || error instanceof LlamaCppConfigurationError) {
                throw error;
            }

            if (error instanceof Error) {
                if (error.name === 'AbortError') {
                    const timeoutError = `Request timeout after ${timeout}ms - server at ${this.host} not responding`;
                    console.error(`[LlamaCppEmbedding] ${timeoutError}`);
                    throw new LlamaCppNetworkError(timeoutError, error);
                }

                if (error.name === 'TypeError' && error.message.includes('fetch')) {
                    const connectionError = `Unable to connect to llama.cpp server at ${this.host}. Please ensure the server is running and accessible.`;
                    console.error(`[LlamaCppEmbedding] ${connectionError}`);
                    throw new LlamaCppNetworkError(connectionError, error);
                }

                // Log original error with full stack trace
                console.error(`[LlamaCppEmbedding] Unexpected error during request:`, error);
                throw new LlamaCppNetworkError(`Unexpected error: ${error.message}`, error);
            }

            // Fallback for non-Error objects
            const unknownError = 'Unknown error occurred during request';
            console.error(`[LlamaCppEmbedding] ${unknownError}:`, error);
            throw new LlamaCppNetworkError(unknownError);
        }
    }

    private preprocessTextForCode(text: string): string {
        if (typeof text !== 'string') {
            throw new LlamaCppConfigurationError('Text must be a string');
        }

        const processedText = this.preprocessText(text);

        // Add code prefix if enabled and not already present
        if (this.config.codePrefix && !processedText.startsWith(this.codePrefix)) {
            return `${this.codePrefix} ${processedText}`;
        }

        return processedText;
    }

    async embed(text: string): Promise<EmbeddingVector> {
        // Preprocess the text with optional code prefix
        const processedText = this.preprocessTextForCode(text);

        // Ensure dimension is detected
        await this.ensureDimensionDetected();

        const requestBody = {
            input: processedText,
            model: this.config.model || 'embedding-model',
        };

        const url = `${this.host}/v1/embeddings`;
        const response = await this.makeRequest(url, requestBody);

        if (!response || typeof response !== 'object') {
            throw new LlamaCppNetworkError('Invalid response format: expected object');
        }

        if (!response.data || !Array.isArray(response.data)) {
            throw new LlamaCppNetworkError('Invalid response format: missing or invalid data array');
        }

        if (response.data.length === 0) {
            throw new LlamaCppNetworkError('Invalid response format: empty data array');
        }

        const firstItem = response.data[0];
        if (!firstItem || typeof firstItem !== 'object') {
            throw new LlamaCppNetworkError('Invalid response format: invalid first data item');
        }

        if (!firstItem.embedding || !Array.isArray(firstItem.embedding)) {
            throw new LlamaCppNetworkError('Invalid response format: missing or invalid embedding array');
        }

        const embedding = response.data[0].embedding;

        return {
            vector: embedding,
            dimension: this.dimension
        };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        if (!Array.isArray(texts)) {
            throw new LlamaCppConfigurationError('Texts must be an array');
        }

        if (texts.length === 0) {
            throw new LlamaCppConfigurationError('Texts array cannot be empty');
        }

        // Preprocess all texts with optional code prefix
        const processedTexts = texts.map(text => this.preprocessTextForCode(text));

        // Ensure dimension is detected
        await this.ensureDimensionDetected();

        const requestBody = {
            input: processedTexts,
            model: this.config.model || 'embedding-model',
        };

        const url = `${this.host}/v1/embeddings`;
        const response = await this.makeRequest(url, requestBody);

        if (!response || typeof response !== 'object') {
            throw new LlamaCppNetworkError('Invalid batch response format: expected object');
        }

        if (!response.data || !Array.isArray(response.data)) {
            throw new LlamaCppNetworkError('Invalid batch response format: missing or invalid data array');
        }

        if (response.data.length === 0) {
            throw new LlamaCppNetworkError('Invalid batch response format: empty data array');
        }

        return response.data.map((item: any, index: number) => {
            if (!item || typeof item !== 'object') {
                throw new LlamaCppNetworkError(`Invalid batch response format: invalid item at index ${index}`);
            }

            if (!item.embedding || !Array.isArray(item.embedding)) {
                throw new LlamaCppNetworkError(`Invalid batch response format: missing or invalid embedding at index ${index}`);
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
        return 'LlamaCpp';
    }

    getModel(): string {
        return this.config.model || 'nomic-embed-code';
    }

    /**
     * Ensure dimension is detected before making embedding requests
     */
    private async ensureDimensionDetected(): Promise<void> {
        if (!this.dimensionDetected && !this.config.dimension) {
            this.dimension = await this.detectDimension();
            this.dimensionDetected = true;
            console.log(`[LlamaCppEmbedding] 📏 Detected embedding dimension: ${this.dimension} for model: ${this.config.model || 'unknown'}`);
        }
    }

    async detectDimension(testText: string = "test"): Promise<number> {
        console.log(`[LlamaCppEmbedding] Detecting embedding dimension...`);

        if (typeof testText !== 'string') {
            throw new LlamaCppConfigurationError('Test text must be a string');
        }

        try {
            // Use raw test text without code prefix for dimension detection
            const processedText = this.preprocessText(testText);

            const requestBody = {
                input: processedText,
                model: this.config.model || 'embedding-model',
            };

            const url = `${this.host}/v1/embeddings`;
            const response = await this.makeRequest(url, requestBody);

                if (!response || typeof response !== 'object') {
                throw new LlamaCppNetworkError('Invalid response format: expected object');
            }

            if (!response.data || !Array.isArray(response.data)) {
                throw new LlamaCppNetworkError('Invalid response format: missing or invalid data array');
            }

            if (response.data.length === 0) {
                throw new LlamaCppNetworkError('Invalid response format: empty data array');
            }

            const firstItem = response.data[0];
            if (!firstItem || typeof firstItem !== 'object') {
                throw new LlamaCppNetworkError('Invalid response format: invalid first data item');
            }

            if (!firstItem.embedding || !Array.isArray(firstItem.embedding)) {
                throw new LlamaCppNetworkError('Invalid response format: missing or invalid embedding array');
            }

            const dimension = firstItem.embedding.length;
            if (dimension <= 0) {
                throw new LlamaCppNetworkError(`Invalid embedding dimension: ${dimension}`);
            }

            console.log(`[LlamaCppEmbedding] Successfully detected embedding dimension: ${dimension}`);
            return dimension;
        } catch (error) {
            if (error instanceof LlamaCppNetworkError || error instanceof LlamaCppConfigurationError) {
                throw error;
            }

            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[LlamaCppEmbedding] Failed to detect dimension:`, error);
            throw new LlamaCppNetworkError(`Failed to detect embedding dimension: ${errorMessage}`, error instanceof Error ? error : undefined);
        }
    }

    /**
     * Set the host URL for llama.cpp server
     * @param host Host URL (e.g., 'http://localhost:8080')
     */
    setHost(host: string): void {
        if (typeof host !== 'string') {
            throw new LlamaCppConfigurationError('Host must be a string');
        }

        this.validateHostUrl(host);

        this.host = this.normalizeHost(host);
        this.config.host = host;
    }

    /**
     * Set the model name
     * @param model Model name
     */
    async setModel(model: string): Promise<void> {
        if (typeof model !== 'string') {
            throw new LlamaCppConfigurationError('Model must be a string');
        }

        if (model.trim() === '') {
            throw new LlamaCppConfigurationError('Model name cannot be empty');
        }

        this.config.model = model;
        // Reset dimension detection when model changes
        this.dimensionDetected = false;
        if (!this.config.dimension) {
            await this.ensureDimensionDetected();
        }
    }

    /**
     * Enable or disable automatic code prefix
     * @param enabled Whether to enable code prefix
     */
    setCodePrefix(enabled: boolean): void {
        if (typeof enabled !== 'boolean') {
            throw new LlamaCppConfigurationError('Code prefix enabled flag must be a boolean');
        }

        this.config.codePrefix = enabled;
    }

    /**
     * Set custom code prefix
     * @param prefix Custom prefix text
     */
    setCustomCodePrefix(prefix: string): void {
        if (typeof prefix !== 'string') {
            throw new LlamaCppConfigurationError('Code prefix must be a string');
        }

        if (prefix.trim() === '') {
            throw new LlamaCppConfigurationError('Code prefix cannot be empty');
        }

        this.codePrefix = prefix;
        this.config.codePrefix = true;
    }

    /**
     * Set request timeout
     * @param timeout Timeout in milliseconds
     */
    setTimeout(timeout: number): void {
        if (typeof timeout !== 'number') {
            throw new LlamaCppConfigurationError('Timeout must be a number');
        }

        if (timeout <= 0) {
            throw new LlamaCppConfigurationError('Timeout must be a positive number');
        }

        if (timeout > 600000) { // 10 minutes max
            throw new LlamaCppConfigurationError('Timeout cannot exceed 600000ms (10 minutes)');
        }

        this.config.timeout = timeout;
    }

    /**
     * Get current configuration
     */
    getConfig(): LlamaCppEmbeddingConfig {
        return { ...this.config };
    }
}