import { VoyageAIClient } from 'voyageai';
import { VoyageAIReranker } from './voyageai-reranker';

const mockRerank = jest.fn();

jest.mock('voyageai', () => ({
    VoyageAIClient: jest.fn().mockImplementation(() => ({
        rerank: mockRerank,
    })),
}));

describe('VoyageAIReranker', () => {
    beforeEach(() => {
        mockRerank.mockReset();
        (VoyageAIClient as unknown as jest.Mock).mockClear();
    });

    it('uses the default model when none is configured', () => {
        const reranker = new VoyageAIReranker({ apiKey: 'test-api-key' });

        expect(VoyageAIClient).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
        expect(reranker.getProvider()).toBe('VoyageAI');
        expect(reranker.getModel()).toBe(VoyageAIReranker.DEFAULT_MODEL);
        expect(Object.keys(VoyageAIReranker.getSupportedModels())).toContain(VoyageAIReranker.DEFAULT_MODEL);
    });

    it('sends the query and documents and maps the response', async () => {
        mockRerank.mockResolvedValue({
            data: [
                { index: 1, relevanceScore: 0.91 },
                { index: 0, relevanceScore: 0.12 },
            ],
        });
        const reranker = new VoyageAIReranker({ apiKey: 'test-api-key', model: 'rerank-2.5-lite' });

        const results = await reranker.rerank('where is auth handled?', ['doc a', 'doc b'], 2);

        expect(mockRerank).toHaveBeenCalledWith({
            query: 'where is auth handled?',
            documents: ['doc a', 'doc b'],
            model: 'rerank-2.5-lite',
            topK: 2,
            truncation: true,
        });
        expect(results).toEqual([
            { index: 1, score: 0.91 },
            { index: 0, score: 0.12 },
        ]);
    });

    it('omits topK when it is not provided', async () => {
        mockRerank.mockResolvedValue({ data: [] });
        const reranker = new VoyageAIReranker({ apiKey: 'test-api-key' });

        await reranker.rerank('query', ['doc']);

        expect(mockRerank.mock.calls[0][0]).not.toHaveProperty('topK');
    });

    it('does not call the API for an empty document list', async () => {
        const reranker = new VoyageAIReranker({ apiKey: 'test-api-key' });

        await expect(reranker.rerank('query', [])).resolves.toEqual([]);
        expect(mockRerank).not.toHaveBeenCalled();
    });

    it('rejects responses without usable results', async () => {
        const reranker = new VoyageAIReranker({ apiKey: 'test-api-key' });

        mockRerank.mockResolvedValueOnce({});
        await expect(reranker.rerank('query', ['doc'])).rejects.toThrow('VoyageAI rerank API returned invalid response');

        mockRerank.mockResolvedValueOnce({ data: [{ index: 0 }] });
        await expect(reranker.rerank('query', ['doc'])).rejects.toThrow('VoyageAI rerank API returned invalid response');
    });
});
