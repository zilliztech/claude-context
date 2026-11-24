import { Context } from './context';
import { Embedding, EmbeddingVector } from './embedding';
import { Splitter } from './splitter';
import { FileSynchronizer } from './sync/synchronizer';
import { VectorDatabase } from './vectordb';

class TestEmbedding extends Embedding {
    protected maxTokens = 8192;

    async detectDimension(): Promise<number> {
        return 3;
    }

    async embed(): Promise<EmbeddingVector> {
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

describe('Context file chunk deletion filter', () => {
    it.each([
        ['say "hi".md', 'relativePath == "say \\"hi\\".md"'],
        ['src\\windows\\path.ts', 'relativePath == "src\\\\windows\\\\path.ts"'],
        ['a\\" or relativePath != "', 'relativePath == "a\\\\\\" or relativePath != \\""'],
    ])('escapes %s in the query expression', async (relativePath, expected) => {
        const vectorDatabase = createVectorDatabase();
        const codeSplitter: Splitter = {
            split: jest.fn().mockResolvedValue([]),
            setChunkSize: jest.fn(),
            setChunkOverlap: jest.fn(),
        };
        const context = new Context({ embedding: new TestEmbedding(), vectorDatabase, codeSplitter });
        const codebasePath = '/project';
        const synchronizer = {
            checkForChanges: jest.fn().mockResolvedValue({ added: [], removed: [relativePath], modified: [] }),
        } as unknown as FileSynchronizer;
        context.setSynchronizer(context.getCollectionName(codebasePath), synchronizer);

        await context.reindexByChange(codebasePath);

        expect(vectorDatabase.query).toHaveBeenCalledWith(expect.any(String), expected, ['id']);
    });
});
