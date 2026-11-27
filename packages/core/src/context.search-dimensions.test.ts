import { Context } from './context';
import { Embedding, EmbeddingVector } from './embedding';
import { Splitter, CodeChunk } from './splitter';
import { VectorDatabase } from './vectordb';

class DimensionEmbedding extends Embedding {
    protected maxTokens = 8192;

    async detectDimension(): Promise<number> {
        return 4;
    }

    async embed(_text: string): Promise<EmbeddingVector> {
        return { vector: [1, 2, 3], dimension: 3 };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        return texts.map(() => ({ vector: [1, 2, 3], dimension: 3 }));
    }

    getDimension(): number {
        return 4;
    }

    getProvider(): string {
        return 'dimension-test';
    }
}

class EmptySplitter implements Splitter {
    async split(_code: string, _language: string, _filePath?: string): Promise<CodeChunk[]> {
        return [];
    }

    setChunkSize(): void { }
    setChunkOverlap(): void { }
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

describe('Context search dimension logging', () => {
    const originalHybridMode = process.env.HYBRID_MODE;
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
        process.env.HYBRID_MODE = 'false';
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        if (originalHybridMode === undefined) {
            delete process.env.HYBRID_MODE;
        } else {
            process.env.HYBRID_MODE = originalHybridMode;
        }
        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('logs provider, expected dimension, and actual query dimension during search', async () => {
        const vectorDatabase = createVectorDatabase();
        const context = new Context({
            embedding: new DimensionEmbedding(),
            vectorDatabase,
            codeSplitter: new EmptySplitter(),
        });

        await context.semanticSearch('/tmp/project', 'query');

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('provider=dimension-test, expected=4, actual=3'));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('expected=4, actual=3'));
    });
});
