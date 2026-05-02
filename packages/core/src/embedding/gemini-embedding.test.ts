import { GoogleGenAI } from '@google/genai';
import { GeminiEmbedding } from './gemini-embedding';

const mockEmbedContent = jest.fn();

jest.mock('@google/genai', () => ({
    GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
            embedContent: mockEmbedContent
        }
    }))
}));

describe('GeminiEmbedding', () => {
    beforeEach(() => {
        mockEmbedContent.mockReset();
        (GoogleGenAI as unknown as jest.Mock).mockClear();
    });

    it('exposes Gemini Embedding 2 model metadata', () => {
        const supportedModels = GeminiEmbedding.getSupportedModels();

        expect(supportedModels['gemini-embedding-2']).toMatchObject({
            dimension: 3072,
            contextLength: 8192,
        });

        const embedding = new GeminiEmbedding({
            apiKey: 'test-api-key',
            model: 'gemini-embedding-2',
        });

        expect(embedding.getDimension()).toBe(3072);
        expect(embedding.getSupportedDimensions()).toContain(3072);
        expect(embedding.getSupportedDimensions()).toContain(768);
    });

    it('keeps batched request behavior for Gemini Embedding 2', async () => {
        mockEmbedContent.mockResolvedValue({
            embeddings: [
                { values: [1, 0, 0] },
                { values: [0, 1, 0] },
            ],
        });

        const embedding = new GeminiEmbedding({
            apiKey: 'test-api-key',
            model: 'gemini-embedding-2',
        });

        const embeddings = await embedding.embedBatch(['first chunk', 'second chunk']);

        expect(embeddings).toEqual([
            { vector: [1, 0, 0], dimension: 3 },
            { vector: [0, 1, 0], dimension: 3 },
        ]);
        expect(mockEmbedContent).toHaveBeenCalledTimes(1);
        expect(mockEmbedContent).toHaveBeenCalledWith({
            model: 'gemini-embedding-2',
            contents: ['first chunk', 'second chunk'],
            config: {
                outputDimensionality: 3072,
            },
        });
    });

    it('keeps the existing batched request behavior for Gemini Embedding 001', async () => {
        mockEmbedContent.mockResolvedValue({
            embeddings: [
                { values: [1, 0, 0] },
                { values: [0, 1, 0] },
            ],
        });

        const embedding = new GeminiEmbedding({
            apiKey: 'test-api-key',
            model: 'gemini-embedding-001',
        });

        const embeddings = await embedding.embedBatch(['first chunk', 'second chunk']);

        expect(embeddings).toEqual([
            { vector: [1, 0, 0], dimension: 3 },
            { vector: [0, 1, 0], dimension: 3 },
        ]);
        expect(mockEmbedContent).toHaveBeenCalledTimes(1);
        expect(mockEmbedContent).toHaveBeenCalledWith({
            model: 'gemini-embedding-001',
            contents: ['first chunk', 'second chunk'],
            config: {
                outputDimensionality: 3072,
            },
        });
    });

    it('throws a clear error when a batched response count does not match the inputs', async () => {
        mockEmbedContent.mockResolvedValue({
            embeddings: [
                { values: [1, 0, 0] },
            ],
        });

        const embedding = new GeminiEmbedding({
            apiKey: 'test-api-key',
            model: 'gemini-embedding-001',
        });

        await expect(embedding.embedBatch(['first chunk', 'second chunk']))
            .rejects
            .toThrow('Gemini API returned 1 embeddings for 2 inputs');
    });

    it('returns an empty batch without calling the Gemini API', async () => {
        const embedding = new GeminiEmbedding({
            apiKey: 'test-api-key',
            model: 'gemini-embedding-2',
        });

        await expect(embedding.embedBatch([])).resolves.toEqual([]);
        expect(mockEmbedContent).not.toHaveBeenCalled();
    });
});
