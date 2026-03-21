import { MiniMaxEmbedding, MiniMaxEmbeddingConfig } from '../minimax-embedding';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('MiniMaxEmbedding', () => {
    const defaultConfig: MiniMaxEmbeddingConfig = {
        apiKey: 'test-api-key',
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should create instance with default config', () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);
            expect(embedding.getProvider()).toBe('MiniMax');
            expect(embedding.getDimension()).toBe(1536);
        });

        it('should accept custom model', () => {
            const embedding = new MiniMaxEmbedding({
                ...defaultConfig,
                model: 'embo-01',
            });
            expect(embedding.getDimension()).toBe(1536);
        });

        it('should accept custom baseURL', () => {
            const embedding = new MiniMaxEmbedding({
                ...defaultConfig,
                baseURL: 'https://custom-api.example.com/v1',
            });
            expect(embedding.getProvider()).toBe('MiniMax');
        });
    });

    describe('getSupportedModels', () => {
        it('should return supported models', () => {
            const models = MiniMaxEmbedding.getSupportedModels();
            expect(models).toHaveProperty('embo-01');
            expect(models['embo-01'].dimension).toBe(1536);
            expect(models['embo-01'].description).toBeDefined();
        });
    });

    describe('getDimension', () => {
        it('should return 1536 for embo-01', () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);
            expect(embedding.getDimension()).toBe(1536);
        });
    });

    describe('detectDimension', () => {
        it('should return known dimension for embo-01', async () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);
            const dim = await embedding.detectDimension();
            expect(dim).toBe(1536);
        });

        it('should call API for unknown model', async () => {
            const embedding = new MiniMaxEmbedding({
                ...defaultConfig,
                model: 'unknown-model',
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    vectors: [new Array(2048).fill(0.1)],
                    total_tokens: 5,
                    base_resp: { status_code: 0, status_msg: 'success' },
                }),
            });

            const dim = await embedding.detectDimension('test');
            expect(dim).toBe(2048);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should throw on API error', async () => {
            const embedding = new MiniMaxEmbedding({
                ...defaultConfig,
                model: 'unknown-model',
            });

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: async () => 'Unauthorized',
            });

            await expect(embedding.detectDimension('test')).rejects.toThrow(
                'Failed to detect dimension'
            );
        });
    });

    describe('embed', () => {
        it('should embed single text', async () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);
            const vector = new Array(1536).fill(0.1);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    vectors: [vector],
                    total_tokens: 10,
                    base_resp: { status_code: 0, status_msg: 'success' },
                }),
            });

            const result = await embedding.embed('hello world');
            expect(result.vector).toEqual(vector);
            expect(result.dimension).toBe(1536);
            expect(mockFetch).toHaveBeenCalledTimes(1);

            // Verify request body
            const callArgs = mockFetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.model).toBe('embo-01');
            expect(body.texts).toEqual(['hello world']);
            expect(body.type).toBe('db');
        });

        it('should send Authorization header', async () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    vectors: [new Array(1536).fill(0)],
                    total_tokens: 5,
                    base_resp: { status_code: 0, status_msg: 'success' },
                }),
            });

            await embedding.embed('test');
            const callArgs = mockFetch.mock.calls[0];
            expect(callArgs[1].headers['Authorization']).toBe('Bearer test-api-key');
        });

        it('should use custom baseURL', async () => {
            const embedding = new MiniMaxEmbedding({
                ...defaultConfig,
                baseURL: 'https://custom.example.com/v1',
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    vectors: [new Array(1536).fill(0)],
                    total_tokens: 5,
                    base_resp: { status_code: 0, status_msg: 'success' },
                }),
            });

            await embedding.embed('test');
            const callArgs = mockFetch.mock.calls[0];
            expect(callArgs[0]).toBe('https://custom.example.com/v1/embeddings');
        });

        it('should throw on HTTP error', async () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error',
            });

            await expect(embedding.embed('test')).rejects.toThrow(
                'Failed to generate MiniMax embedding'
            );
        });

        it('should throw on API-level error', async () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    vectors: [],
                    total_tokens: 0,
                    base_resp: { status_code: 1001, status_msg: 'Invalid API key' },
                }),
            });

            await expect(embedding.embed('test')).rejects.toThrow('Invalid API key');
        });

        it('should preprocess empty text', async () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    vectors: [new Array(1536).fill(0)],
                    total_tokens: 1,
                    base_resp: { status_code: 0, status_msg: 'success' },
                }),
            });

            await embedding.embed('');
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.texts).toEqual([' ']); // Empty string replaced with space
        });
    });

    describe('embedBatch', () => {
        it('should embed multiple texts', async () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);
            const vectors = [
                new Array(1536).fill(0.1),
                new Array(1536).fill(0.2),
                new Array(1536).fill(0.3),
            ];

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    vectors,
                    total_tokens: 30,
                    base_resp: { status_code: 0, status_msg: 'success' },
                }),
            });

            const results = await embedding.embedBatch(['hello', 'world', 'test']);
            expect(results).toHaveLength(3);
            expect(results[0].vector).toEqual(vectors[0]);
            expect(results[1].vector).toEqual(vectors[1]);
            expect(results[2].vector).toEqual(vectors[2]);
            results.forEach(r => expect(r.dimension).toBe(1536));

            // Verify all texts sent in single request
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.texts).toEqual(['hello', 'world', 'test']);
        });

        it('should throw on batch error', async () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: async () => 'Rate limit exceeded',
            });

            await expect(
                embedding.embedBatch(['hello', 'world'])
            ).rejects.toThrow('Failed to generate MiniMax batch embeddings');
        });
    });

    describe('setType', () => {
        it('should change embedding type to query', async () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);
            embedding.setType('query');

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    vectors: [new Array(1536).fill(0)],
                    total_tokens: 5,
                    base_resp: { status_code: 0, status_msg: 'success' },
                }),
            });

            await embedding.embed('search query');
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.type).toBe('query');
        });
    });

    describe('setModel', () => {
        it('should update model and dimension for known model', async () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);
            await embedding.setModel('embo-01');
            expect(embedding.getDimension()).toBe(1536);
        });

        it('should detect dimension for unknown model', async () => {
            const embedding = new MiniMaxEmbedding(defaultConfig);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    vectors: [new Array(768).fill(0)],
                    total_tokens: 5,
                    base_resp: { status_code: 0, status_msg: 'success' },
                }),
            });

            await embedding.setModel('custom-model');
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });
});
