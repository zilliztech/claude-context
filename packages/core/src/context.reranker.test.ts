import { Context } from './context';
import { Embedding, EmbeddingVector } from './embedding';
import { Reranker, RerankResult } from './reranker';
import { VectorDatabase, VectorDocument, VectorSearchResult } from './vectordb';

class StaticEmbedding extends Embedding {
    protected maxTokens = 8192;

    async detectDimension(): Promise<number> {
        return 3;
    }

    async embed(_text: string): Promise<EmbeddingVector> {
        return { vector: [1, 0, 0], dimension: 3 };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        return texts.map(() => ({ vector: [1, 0, 0], dimension: 3 }));
    }

    getDimension(): number {
        return 3;
    }

    getProvider(): string {
        return 'test';
    }
}

class StubReranker extends Reranker {
    readonly rerank = jest.fn<Promise<RerankResult[]>, [string, string[], number?]>();

    getProvider(): string {
        return 'StubRerank';
    }

    getModel(): string {
        return 'stub-model';
    }
}

const createVectorDatabase = (): jest.Mocked<VectorDatabase> => ({
    createCollection: jest.fn().mockResolvedValue(undefined),
    createHybridCollection: jest.fn().mockResolvedValue(undefined),
    dropCollection: jest.fn().mockResolvedValue(undefined),
    hasCollection: jest.fn().mockResolvedValue(true),
    listCollections: jest.fn().mockResolvedValue([]),
    insert: jest.fn().mockResolvedValue(undefined),
    insertHybrid: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockResolvedValue([]),
    hybridSearch: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),
    getCollectionDescription: jest.fn().mockResolvedValue(''),
    checkCollectionLimit: jest.fn().mockResolvedValue(true),
    getCollectionRowCount: jest.fn().mockResolvedValue(0),
});

function hit(relativePath: string, startLine: number, endLine: number, score: number): VectorSearchResult {
    const document: VectorDocument = {
        id: `${relativePath}:${startLine}`,
        vector: [],
        content: `content of ${relativePath}:${startLine}`,
        relativePath,
        startLine,
        endLine,
        fileExtension: '.ts',
        metadata: { language: 'typescript' },
    };
    return { document, score };
}

const HITS = [
    hit('a.ts', 1, 10, 0.9),
    hit('b.ts', 1, 10, 0.8),
    hit('c.ts', 1, 10, 0.7),
    hit('d.ts', 1, 10, 0.6),
];

describe('Context semantic search reranking', () => {
    let originalHybridMode: string | undefined;

    beforeEach(() => {
        originalHybridMode = process.env.HYBRID_MODE;
        process.env.HYBRID_MODE = 'false';
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        if (originalHybridMode === undefined) {
            delete process.env.HYBRID_MODE;
        } else {
            process.env.HYBRID_MODE = originalHybridMode;
        }
        jest.restoreAllMocks();
    });

    function createContext(reranker?: Reranker) {
        const vectorDatabase = createVectorDatabase();
        vectorDatabase.search.mockResolvedValue(HITS);
        vectorDatabase.hybridSearch.mockResolvedValue(HITS);
        const context = new Context({
            embedding: new StaticEmbedding(),
            vectorDatabase,
            reranker,
        });
        return { context, vectorDatabase };
    }

    it('keeps the existing search behaviour when no reranker is configured', async () => {
        const { context, vectorDatabase } = createContext();

        const results = await context.semanticSearch('/repo', 'query', 2, 0.3);

        expect(context.getReranker()).toBeUndefined();
        expect(vectorDatabase.search).toHaveBeenCalledWith(
            expect.any(String),
            [1, 0, 0],
            { topK: 2, threshold: 0.3, filterExpr: undefined }
        );
        // The mocked database ignores topK, so every hit is passed through as before.
        expect(results.map(result => result.relativePath)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
        expect(results.map(result => result.score)).toEqual([0.9, 0.8, 0.7, 0.6]);
    });

    it('retrieves extra candidates and returns them in reranked order with reranker scores', async () => {
        const reranker = new StubReranker();
        reranker.rerank.mockResolvedValue([
            { index: 3, score: 0.99 },
            { index: 1, score: 0.5 },
        ]);
        const { context, vectorDatabase } = createContext(reranker);

        const results = await context.semanticSearch('/repo', 'find d', 2, 0.3, 'fileExtension in [".ts"]');

        expect(vectorDatabase.search).toHaveBeenCalledWith(
            expect.any(String),
            [1, 0, 0],
            { topK: 6, threshold: 0.3, filterExpr: 'fileExtension in [".ts"]' }
        );
        expect(reranker.rerank).toHaveBeenCalledWith(
            'find d',
            HITS.map(result => result.document.content),
            2
        );
        expect(results).toEqual([
            {
                content: 'content of d.ts:1',
                relativePath: 'd.ts',
                startLine: 1,
                endLine: 10,
                language: 'typescript',
                score: 0.99,
            },
            {
                content: 'content of b.ts:1',
                relativePath: 'b.ts',
                startLine: 1,
                endLine: 10,
                language: 'typescript',
                score: 0.5,
            },
        ]);
    });

    it('widens and caps the hybrid search candidate pool when reranking', async () => {
        process.env.HYBRID_MODE = 'true';
        const reranker = new StubReranker();
        reranker.rerank.mockResolvedValue([{ index: 2, score: 0.7 }]);
        const { context, vectorDatabase } = createContext(reranker);

        const results = await context.semanticSearch('/repo', 'query', 50);

        const [, requests, options] = vectorDatabase.hybridSearch.mock.calls[0];
        expect(requests.map(request => request.limit)).toEqual([100, 100]);
        expect(options?.limit).toBe(100);
        expect(results.map(result => result.relativePath)).toEqual(['c.ts']);
    });

    it('deduplicates overlapping chunks before sending them to the reranker', async () => {
        const reranker = new StubReranker();
        reranker.rerank.mockResolvedValue([{ index: 1, score: 0.8 }, { index: 0, score: 0.2 }]);
        const { context, vectorDatabase } = createContext(reranker);
        vectorDatabase.search.mockResolvedValue([
            hit('a.ts', 1, 10, 0.9),
            hit('a.ts', 2, 10, 0.85),
            hit('b.ts', 1, 10, 0.8),
        ]);

        const results = await context.semanticSearch('/repo', 'query', 5);

        expect(reranker.rerank).toHaveBeenCalledWith('query', ['content of a.ts:1', 'content of b.ts:1'], 5);
        expect(results.map(result => result.relativePath)).toEqual(['b.ts', 'a.ts']);
    });

    it('ignores out-of-range and repeated indices from the reranker', async () => {
        const reranker = new StubReranker();
        reranker.rerank.mockResolvedValue([
            { index: 7, score: 0.9 },
            { index: 2, score: 0.8 },
            { index: 2, score: 0.7 },
            { index: -1, score: 0.6 },
            { index: 0, score: 0.5 },
        ]);
        const { context } = createContext(reranker);

        const results = await context.semanticSearch('/repo', 'query', 3);

        expect(results.map(result => [result.relativePath, result.score])).toEqual([
            ['c.ts', 0.8],
            ['a.ts', 0.5],
        ]);
    });

    it('falls back to the vector search order when the reranker fails', async () => {
        const reranker = new StubReranker();
        reranker.rerank.mockRejectedValue(new Error('rate limited'));
        const { context } = createContext(reranker);

        const results = await context.semanticSearch('/repo', 'query', 2);

        expect(results.map(result => [result.relativePath, result.score])).toEqual([
            ['a.ts', 0.9],
            ['b.ts', 0.8],
        ]);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
    });

    it('falls back to the vector search order when the reranker returns no usable results', async () => {
        const reranker = new StubReranker();
        reranker.rerank.mockResolvedValue([{ index: 9, score: 0.9 }]);
        const { context } = createContext(reranker);

        const results = await context.semanticSearch('/repo', 'query', 3);

        expect(results.map(result => result.relativePath)).toEqual(['a.ts', 'b.ts', 'c.ts']);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no usable results'));
    });

    it('does not call the reranker when there are no candidates', async () => {
        const reranker = new StubReranker();
        const { context, vectorDatabase } = createContext(reranker);
        vectorDatabase.search.mockResolvedValue([]);

        await expect(context.semanticSearch('/repo', 'query', 2)).resolves.toEqual([]);
        expect(reranker.rerank).not.toHaveBeenCalled();
    });

    it('can enable and disable reranking after construction', async () => {
        const reranker = new StubReranker();
        reranker.rerank.mockResolvedValue([{ index: 3, score: 1 }]);
        const { context, vectorDatabase } = createContext();

        context.updateReranker(reranker);
        expect(context.getReranker()).toBe(reranker);
        const reranked = await context.semanticSearch('/repo', 'query', 1);
        expect(reranked.map(result => result.relativePath)).toEqual(['d.ts']);
        expect(vectorDatabase.search).toHaveBeenLastCalledWith(
            expect.any(String),
            [1, 0, 0],
            expect.objectContaining({ topK: 3 })
        );

        context.updateReranker(undefined);
        const plain = await context.semanticSearch('/repo', 'query', 1);
        expect(reranker.rerank).toHaveBeenCalledTimes(1);
        expect(plain[0].relativePath).toBe('a.ts');
        expect(vectorDatabase.search).toHaveBeenLastCalledWith(
            expect.any(String),
            [1, 0, 0],
            expect.objectContaining({ topK: 1 })
        );
    });
});
