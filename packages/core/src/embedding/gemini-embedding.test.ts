import { GeminiEmbedding, GeminiEmbeddingConfig } from './gemini-embedding';
import { GoogleGenAI } from '@google/genai';

// Mock GoogleGenAI
jest.mock('@google/genai');
const MockedGoogleGenAI = GoogleGenAI as jest.MockedClass<typeof GoogleGenAI>;

describe('GeminiEmbedding', () => {
    let mockClient: jest.Mocked<GoogleGenAI>;
    let mockEmbedContent: jest.MockedFunction<any>;
    let config: GeminiEmbeddingConfig;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        jest.resetAllMocks();

        // Create mock client
        mockEmbedContent = jest.fn();
        mockClient = {
            models: {
                embedContent: mockEmbedContent
            }
        } as any;

        MockedGoogleGenAI.mockImplementation(() => mockClient);

        // Default configuration
        config = {
            model: 'gemini-embedding-001',
            apiKey: 'test-api-key',
            maxRetries: 3,
            baseDelay: 100 // Use smaller delay for tests
        };

        // Mock console.log to avoid test output noise
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Constructor and Configuration', () => {
        it('should initialize with default configuration', () => {
            const embedding = new GeminiEmbedding({
                model: 'gemini-embedding-001',
                apiKey: 'test-key'
            });

            expect(embedding.getDimension()).toBe(3072);
            expect(embedding.getProvider()).toBe('Gemini');
            expect(embedding.getRetryConfig()).toEqual({
                maxRetries: 3,
                baseDelay: 1000
            });
        });

        it('should initialize with custom retry configuration', () => {
            const embedding = new GeminiEmbedding({
                model: 'gemini-embedding-001',
                apiKey: 'test-key',
                maxRetries: 5,
                baseDelay: 2000
            });

            expect(embedding.getRetryConfig()).toEqual({
                maxRetries: 5,
                baseDelay: 2000
            });
        });

        it('should initialize with custom output dimensionality', () => {
            const embedding = new GeminiEmbedding({
                model: 'gemini-embedding-001',
                apiKey: 'test-key',
                outputDimensionality: 1536
            });

            expect(embedding.getDimension()).toBe(1536);
        });

        it('should create GoogleGenAI client with correct configuration', () => {
            new GeminiEmbedding(config);

            expect(MockedGoogleGenAI).toHaveBeenCalledWith({
                apiKey: 'test-api-key'
            });
        });
    });

    describe('Basic Embedding Functionality', () => {
        let embedding: GeminiEmbedding;

        beforeEach(() => {
            embedding = new GeminiEmbedding(config);
        });

        it('should successfully embed single text', async () => {
            const mockResponse = {
                embeddings: [{
                    values: [0.1, 0.2, 0.3]
                }]
            };
            mockEmbedContent.mockResolvedValueOnce(mockResponse);

            const result = await embedding.embed('test text');

            expect(result).toEqual({
                vector: [0.1, 0.2, 0.3],
                dimension: 3
            });

            expect(mockEmbedContent).toHaveBeenCalledWith({
                model: 'gemini-embedding-001',
                contents: 'test text',
                config: {
                    outputDimensionality: 3072
                }
            });
        });

        it('should successfully embed batch of texts', async () => {
            const mockResponse = {
                embeddings: [
                    { values: [0.1, 0.2, 0.3] },
                    { values: [0.4, 0.5, 0.6] }
                ]
            };
            mockEmbedContent.mockResolvedValueOnce(mockResponse);

            const result = await embedding.embedBatch(['text1', 'text2']);

            expect(result).toEqual([
                { vector: [0.1, 0.2, 0.3], dimension: 3 },
                { vector: [0.4, 0.5, 0.6], dimension: 3 }
            ]);
        });

        it('should handle empty text input', async () => {
            const mockResponse = {
                embeddings: [{
                    values: [0.0, 0.0, 0.0]
                }]
            };
            mockEmbedContent.mockResolvedValueOnce(mockResponse);

            const result = await embedding.embed('');
            expect(result.vector).toEqual([0.0, 0.0, 0.0]);
        });

        it('should handle empty batch input', async () => {
            const result = await embedding.embedBatch([]);
            expect(result).toEqual([]);
        });
    });

    describe('Error Classification', () => {
        let embedding: GeminiEmbedding;

        beforeEach(() => {
            embedding = new GeminiEmbedding(config);
        });

        it('should classify network errors as retryable', async () => {
            const networkErrors = [
                { code: 'ECONNREFUSED' },
                { code: 'ETIMEDOUT' },
                { code: 'ENOTFOUND' },
                { code: 'EAI_AGAIN' }
            ];

            for (const error of networkErrors) {
                mockEmbedContent
                    .mockRejectedValueOnce(error)
                    .mockRejectedValueOnce(error)
                    .mockRejectedValueOnce(error)
                    .mockRejectedValueOnce(error);
                
                await expect(embedding.embed('test')).rejects.toThrow();
                expect(mockEmbedContent).toHaveBeenCalledTimes(4); // Should retry 3 times + original attempt
                mockEmbedContent.mockClear();
            }
        });

        it('should classify HTTP status codes as retryable', async () => {
            const retryableStatuses = [429, 500, 502, 503, 504];

            for (const status of retryableStatuses) {
                const error = { status };
                mockEmbedContent.mockRejectedValue(error);
                
                await expect(embedding.embed('test')).rejects.toThrow();
                expect(mockEmbedContent).toHaveBeenCalledTimes(4); // Should retry
                mockEmbedContent.mockClear();
            }
        });

        it('should classify error messages as retryable', async () => {
            const retryableMessages = [
                'rate limit exceeded',
                'quota exceeded',
                'service unavailable',
                'connection timeout',
                'network error'
            ];

            for (const message of retryableMessages) {
                const error = new Error(message);
                mockEmbedContent.mockRejectedValue(error);
                
                await expect(embedding.embed('test')).rejects.toThrow();
                expect(mockEmbedContent).toHaveBeenCalledTimes(4); // Should retry
                mockEmbedContent.mockClear();
            }
        });

        it('should not retry non-retryable errors', async () => {
            const nonRetryableErrors = [
                { status: 400 }, // Bad request
                { status: 401 }, // Unauthorized
                { status: 403 }, // Forbidden
                new Error('invalid api key'),
                new Error('malformed request')
            ];

            for (const error of nonRetryableErrors) {
                mockEmbedContent.mockRejectedValueOnce(error);
                
                try {
                    await embedding.embed('test');
                    expect(true).toBe(false); // Should not reach here
                } catch (e) {
                    expect(e).toBe(error); // Should throw the original error
                }
                expect(mockEmbedContent).toHaveBeenCalledTimes(1); // Should not retry
                mockEmbedContent.mockClear();
            }
        });
    });

    describe('Retry Mechanism', () => {
        let embedding: GeminiEmbedding;

        beforeEach(() => {
            embedding = new GeminiEmbedding(config);
        });

        it('should implement exponential backoff', async () => {
            const retryableError = { status: 503 };
            mockEmbedContent
                .mockRejectedValueOnce(retryableError)
                .mockRejectedValueOnce(retryableError)
                .mockRejectedValueOnce(retryableError)
                .mockRejectedValueOnce(retryableError);

            // Mock setTimeout to execute callbacks immediately without delay
            const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
                (callback as Function)(); // Execute immediately
                return {} as any;
            });

            await expect(embedding.embed('test')).rejects.toThrow('failed after 4 attempts');
            
            // Verify exponential backoff delays were requested
            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100); // baseDelay
            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 200); // 2x baseDelay
            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 400); // 4x baseDelay

            setTimeoutSpy.mockRestore();
        });

        it('should cap delay at 10 seconds', async () => {
            const longDelayEmbedding = new GeminiEmbedding({
                ...config,
                baseDelay: 5000,
                maxRetries: 2
            });

            const retryableError = { status: 503 };
            mockEmbedContent
                .mockRejectedValueOnce(retryableError)
                .mockRejectedValueOnce(retryableError)
                .mockRejectedValueOnce(retryableError);

            const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
                (callback as Function)(); // Execute immediately
                return {} as any;
            });

            await expect(longDelayEmbedding.embed('test')).rejects.toThrow();

            // Verify delays are capped at 10 seconds
            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000); // Capped at 10s

            setTimeoutSpy.mockRestore();
        });

        it('should succeed after retries', async () => {
            const retryableError = { status: 503 };
            const successResponse = {
                embeddings: [{
                    values: [0.1, 0.2, 0.3]
                }]
            };

            mockEmbedContent
                .mockRejectedValueOnce(retryableError)
                .mockRejectedValueOnce(retryableError)
                .mockResolvedValueOnce(successResponse);

            // Mock setTimeout to execute callbacks immediately without delay
            const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
                (callback as Function)(); // Execute immediately
                return {} as any;
            });

            const result = await embedding.embed('test');

            expect(result).toEqual({
                vector: [0.1, 0.2, 0.3],
                dimension: 3
            });
            expect(mockEmbedContent).toHaveBeenCalledTimes(3);

            setTimeoutSpy.mockRestore();
        });

        it('should respect maxRetries configuration', async () => {
            const noRetryEmbedding = new GeminiEmbedding({
                ...config,
                maxRetries: 0
            });

            const retryableError = { status: 503 };
            mockEmbedContent.mockRejectedValue(retryableError);

            await expect(noRetryEmbedding.embed('test')).rejects.toThrow();
            expect(mockEmbedContent).toHaveBeenCalledTimes(1); // Only original attempt
        });
    });

    describe('Batch Processing with Fallback', () => {
        let embedding: GeminiEmbedding;

        beforeEach(() => {
            embedding = new GeminiEmbedding(config);
        });

        it('should fall back to individual processing when batch fails', async () => {
            const batchError = new Error('batch processing failed');
            const individualResponses = [
                { embeddings: [{ values: [0.1, 0.2, 0.3] }] },
                { embeddings: [{ values: [0.4, 0.5, 0.6] }] }
            ];

            mockEmbedContent
                .mockRejectedValueOnce(batchError) // Batch call fails
                .mockResolvedValueOnce(individualResponses[0]) // First individual call
                .mockResolvedValueOnce(individualResponses[1]); // Second individual call

            const result = await embedding.embedBatch(['text1', 'text2']);

            expect(result).toEqual([
                { vector: [0.1, 0.2, 0.3], dimension: 3 },
                { vector: [0.4, 0.5, 0.6], dimension: 3 }
            ]);

            expect(mockEmbedContent).toHaveBeenCalledTimes(3); // 1 batch + 2 individual
        });

        it('should preserve order in fallback processing', async () => {
            const batchError = new Error('batch failed');
            const texts = ['text1', 'text2', 'text3'];
            const individualResponses = texts.map((_, i) => ({
                embeddings: [{ values: [i * 0.1, i * 0.2, i * 0.3] }]
            }));

            mockEmbedContent
                .mockRejectedValueOnce(batchError)
                .mockResolvedValueOnce(individualResponses[0])
                .mockResolvedValueOnce(individualResponses[1])
                .mockResolvedValueOnce(individualResponses[2]);

            const result = await embedding.embedBatch(texts);

            expect(result).toEqual([
                { vector: [0.0, 0.0, 0.0], dimension: 3 },
                { vector: [0.1, 0.2, 0.3], dimension: 3 },
                { vector: [0.2, 0.4, 0.6], dimension: 3 }
            ]);
        });

        it('should handle mixed success/failure in fallback', async () => {
            const batchError = new Error('batch failed');
            const successResponse = { embeddings: [{ values: [0.1, 0.2, 0.3] }] };
            const individualError = new Error('individual failed');

            mockEmbedContent
                .mockRejectedValueOnce(batchError) // Batch fails
                .mockResolvedValueOnce(successResponse) // First individual succeeds
                .mockRejectedValue(individualError); // Second individual fails after retries

            await expect(embedding.embedBatch(['text1', 'text2'])).rejects.toThrow();
        });
    });

    describe('Configuration Methods', () => {
        let embedding: GeminiEmbedding;

        beforeEach(() => {
            embedding = new GeminiEmbedding(config);
        });

        it('should update model configuration', () => {
            embedding.setModel('new-model');
            
            // Verify model is updated by checking internal state through dimension detection
            expect(embedding.getDimension()).toBe(3072); // Default for unknown models
        });

        it('should update output dimensionality', () => {
            embedding.setOutputDimensionality(1536);
            expect(embedding.getDimension()).toBe(1536);
        });

        it('should update retry configuration', () => {
            embedding.setMaxRetries(5);
            embedding.setBaseDelay(2000);

            expect(embedding.getRetryConfig()).toEqual({
                maxRetries: 5,
                baseDelay: 2000
            });
        });

        it('should return client instance', () => {
            const client = embedding.getClient();
            expect(client).toBe(mockClient);
        });
    });

    describe('Model Support', () => {
        it('should return supported models', () => {
            const supportedModels = GeminiEmbedding.getSupportedModels();
            
            expect(supportedModels).toHaveProperty('gemini-embedding-001');
            expect(supportedModels['gemini-embedding-001']).toEqual({
                dimension: 3072,
                contextLength: 2048,
                description: 'Latest Gemini embedding model with state-of-the-art performance (recommended)',
                supportedDimensions: [3072, 1536, 768, 256]
            });
        });

        it('should check dimension support', () => {
            const embedding = new GeminiEmbedding(config);
            
            expect(embedding.isDimensionSupported(3072)).toBe(true);
            expect(embedding.isDimensionSupported(1536)).toBe(true);
            expect(embedding.isDimensionSupported(512)).toBe(false);
        });

        it('should return supported dimensions', () => {
            const embedding = new GeminiEmbedding(config);
            const dimensions = embedding.getSupportedDimensions();
            
            expect(dimensions).toEqual([3072, 1536, 768, 256]);
        });
    });

    describe('Edge Cases and Error Handling', () => {
        let embedding: GeminiEmbedding;

        beforeEach(() => {
            embedding = new GeminiEmbedding(config);
        });

        it('should handle invalid API response - missing embeddings', async () => {
            mockEmbedContent.mockResolvedValueOnce({});

            await expect(embedding.embed('test')).rejects.toThrow('Gemini API returned invalid response');
        });

        it('should handle invalid API response - missing values', async () => {
            mockEmbedContent.mockResolvedValueOnce({
                embeddings: [{}]
            });

            await expect(embedding.embed('test')).rejects.toThrow('Gemini API returned invalid response');
        });

        it('should handle invalid batch response', async () => {
            const invalidResponse = {
                embeddings: [
                    { values: [0.1, 0.2, 0.3] },
                    {} // Missing values
                ]
            };
            
            // Mock to ensure no fallback by making individual calls fail too
            mockEmbedContent
                .mockResolvedValueOnce(invalidResponse) // Batch call
                .mockRejectedValue(new Error('Individual call failed')); // Prevent fallback

            // Since the batch has invalid data, it should throw during processing
            await expect(embedding.embedBatch(['text1', 'text2'])).rejects.toThrow('Individual call failed');
        });

        it('should handle very long text input', async () => {
            const longText = 'a'.repeat(10000);
            const mockResponse = {
                embeddings: [{
                    values: [0.1, 0.2, 0.3]
                }]
            };
            mockEmbedContent.mockResolvedValueOnce(mockResponse);

            const result = await embedding.embed(longText);
            expect(result.vector).toEqual([0.1, 0.2, 0.3]);
        });

        it('should handle concurrent requests', async () => {
            const mockResponse = {
                embeddings: [{
                    values: [0.1, 0.2, 0.3]
                }]
            };
            mockEmbedContent.mockResolvedValue(mockResponse);

            const promises = [
                embedding.embed('text1'),
                embedding.embed('text2'),
                embedding.embed('text3')
            ];

            const results = await Promise.all(promises);
            expect(results).toHaveLength(3);
            expect(mockEmbedContent).toHaveBeenCalledTimes(3);
        });

        it('should handle undefined and null inputs gracefully', async () => {
            const mockResponse = {
                embeddings: [{
                    values: [0.0, 0.0, 0.0]
                }]
            };
            mockEmbedContent.mockResolvedValue(mockResponse);

            // These should not throw, but convert to empty string
            await embedding.embed(null as any);
            await embedding.embed(undefined as any);
            
            expect(mockEmbedContent).toHaveBeenCalledWith(
                expect.objectContaining({
                    contents: '' // Should be converted to empty string
                })
            );
        });
    });

    describe('Performance and Reliability', () => {
        let embedding: GeminiEmbedding;

        beforeEach(() => {
            embedding = new GeminiEmbedding(config);
            jest.useRealTimers(); // Use real timers for performance tests
        });

        it('should complete successful request quickly', async () => {
            const mockResponse = {
                embeddings: [{
                    values: [0.1, 0.2, 0.3]
                }]
            };
            mockEmbedContent.mockResolvedValueOnce(mockResponse);

            const startTime = Date.now();
            await embedding.embed('test');
            const endTime = Date.now();

            expect(endTime - startTime).toBeLessThan(100); // Should complete very quickly with mock
        });

        it('should handle large batch sizes', async () => {
            const batchSize = 100;
            const texts = Array.from({ length: batchSize }, (_, i) => `text${i}`);
            const mockResponse = {
                embeddings: texts.map(() => ({ values: [0.1, 0.2, 0.3] }))
            };
            mockEmbedContent.mockResolvedValueOnce(mockResponse);

            const result = await embedding.embedBatch(texts);
            expect(result).toHaveLength(batchSize);
        });
    });
});