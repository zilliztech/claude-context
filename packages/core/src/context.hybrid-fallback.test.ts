import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Context } from './context';
import { Embedding, EmbeddingVector } from './embedding';
import { VectorDatabase, MilvusUnsupportedSparseVectorError } from './vectordb';

class StubEmbedding extends Embedding {
    protected maxTokens = 8192;
    async detectDimension(): Promise<number> { return 3; }
    async embed(): Promise<EmbeddingVector> { return { vector: [1, 0, 0], dimension: 3 }; }
    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        return texts.map(() => ({ vector: [1, 0, 0], dimension: 3 }));
    }
    getDimension(): number { return 3; }
    getProvider(): string { return 'stub'; }
}

const makeVectorDb = (overrides: Partial<jest.Mocked<VectorDatabase>> = {}): jest.Mocked<VectorDatabase> => ({
    createCollection: jest.fn().mockResolvedValue(undefined),
    createHybridCollection: jest.fn().mockResolvedValue(undefined),
    dropCollection: jest.fn().mockResolvedValue(undefined),
    hasCollection: jest.fn().mockResolvedValue(false),
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
    ...overrides,
});

describe('Context hybrid SparseFloatVector fallback', () => {
    let tempRoot: string;
    let codebasePath: string;
    let originalHome: string | undefined;
    let originalHybridMode: string | undefined;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-hybrid-'));
        const homeDir = path.join(tempRoot, 'home');
        await fs.mkdir(homeDir, { recursive: true });
        codebasePath = path.join(tempRoot, 'project');
        await fs.mkdir(codebasePath);
        originalHome = process.env.HOME;
        originalHybridMode = process.env.HYBRID_MODE;
        process.env.HOME = homeDir;
        delete process.env.HYBRID_MODE;
    });

    afterEach(async () => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalHybridMode === undefined) delete process.env.HYBRID_MODE;
        else process.env.HYBRID_MODE = originalHybridMode;
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('falls back to dense collection when HYBRID_MODE is unspecified and Milvus rejects type 104', async () => {
        const vectorDatabase = makeVectorDb({
            createHybridCollection: jest.fn().mockRejectedValue(
                new MilvusUnsupportedSparseVectorError('field data type: 104 is not supported')
            ),
        });
        const context = new Context({
            embedding: new StubEmbedding(),
            vectorDatabase,
        });

        await context.getPreparedCollection(codebasePath);

        expect(vectorDatabase.createHybridCollection).toHaveBeenCalledTimes(1);
        expect(vectorDatabase.createCollection).toHaveBeenCalledTimes(1);

        const denseCallName = vectorDatabase.createCollection.mock.calls[0][0];
        expect(denseCallName).toMatch(/^code_chunks_/);
        expect(denseCallName).not.toMatch(/^hybrid_code_chunks_/);

        // After fallback, getCollectionName should reflect the dense override.
        expect(context.getCollectionName(codebasePath)).toBe(denseCallName);
    });

    it('reuses an existing dense collection on the fallback path', async () => {
        const hasCollection = jest.fn()
            .mockResolvedValueOnce(false)  // hybrid name lookup before failure
            .mockResolvedValueOnce(true);  // dense name lookup after fallback
        const vectorDatabase = makeVectorDb({
            hasCollection,
            createHybridCollection: jest.fn().mockRejectedValue(
                new MilvusUnsupportedSparseVectorError('data type 104 not supported')
            ),
        });
        const context = new Context({
            embedding: new StubEmbedding(),
            vectorDatabase,
        });

        await context.getPreparedCollection(codebasePath);

        expect(vectorDatabase.createCollection).not.toHaveBeenCalled();
    });

    it('rethrows with guidance when HYBRID_MODE is explicitly true', async () => {
        process.env.HYBRID_MODE = 'true';
        const vectorDatabase = makeVectorDb({
            createHybridCollection: jest.fn().mockRejectedValue(
                new MilvusUnsupportedSparseVectorError('field data type: 104 is not supported')
            ),
        });
        const context = new Context({
            embedding: new StubEmbedding(),
            vectorDatabase,
        });

        await expect(context.getPreparedCollection(codebasePath)).rejects.toThrow(/HYBRID_MODE=true/);
        expect(vectorDatabase.createCollection).not.toHaveBeenCalled();
    });

    it('does not catch unrelated errors from createHybridCollection', async () => {
        const vectorDatabase = makeVectorDb({
            createHybridCollection: jest.fn().mockRejectedValue(new Error('connection refused')),
        });
        const context = new Context({
            embedding: new StubEmbedding(),
            vectorDatabase,
        });

        await expect(context.getPreparedCollection(codebasePath)).rejects.toThrow(/connection refused/);
        expect(vectorDatabase.createCollection).not.toHaveBeenCalled();
    });
});
