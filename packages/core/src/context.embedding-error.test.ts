import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Context, EmbeddingError } from './context';
import { Embedding, EmbeddingVector } from './embedding';
import { Splitter, CodeChunk } from './splitter';
import { VectorDatabase } from './vectordb';

type EmbeddingMode = 'throw' | 'empty' | 'short';

class FailingEmbedding extends Embedding {
    protected maxTokens = 8192;

    constructor(private readonly mode: EmbeddingMode) {
        super();
    }

    async detectDimension(): Promise<number> {
        return 3;
    }

    async embed(_text: string): Promise<EmbeddingVector> {
        return { vector: [1, 0, 0], dimension: 3 };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        if (this.mode === 'throw') {
            throw new Error('quota exhausted');
        }

        if (this.mode === 'empty') {
            return [];
        }

        return texts.slice(0, Math.max(0, texts.length - 1)).map(() => ({
            vector: [1, 0, 0],
            dimension: 3,
        }));
    }

    getDimension(): number {
        return 3;
    }

    getProvider(): string {
        return 'test';
    }
}

class OneChunkSplitter implements Splitter {
    async split(code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        return [{
            content: code,
            metadata: {
                startLine: 1,
                endLine: 1,
                language,
                filePath,
            },
        }];
    }

    setChunkSize(): void { }
    setChunkOverlap(): void { }
}

const createVectorDatabase = (): jest.Mocked<VectorDatabase> => ({
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
});

describe('Context embedding failure handling', () => {
    let tempRoot: string;
    let originalHome: string | undefined;
    let originalHybridMode: string | undefined;
    let originalEmbeddingBatchSize: string | undefined;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-embedding-error-'));
        const homeDir = path.join(tempRoot, 'home');
        await fs.mkdir(homeDir, { recursive: true });
        originalHome = process.env.HOME;
        originalHybridMode = process.env.HYBRID_MODE;
        originalEmbeddingBatchSize = process.env.EMBEDDING_BATCH_SIZE;
        process.env.HOME = homeDir;
        process.env.HYBRID_MODE = 'false';
    });

    afterEach(async () => {
        if (originalHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = originalHome;
        }
        if (originalHybridMode === undefined) {
            delete process.env.HYBRID_MODE;
        } else {
            process.env.HYBRID_MODE = originalHybridMode;
        }
        if (originalEmbeddingBatchSize === undefined) {
            delete process.env.EMBEDDING_BATCH_SIZE;
        } else {
            process.env.EMBEDDING_BATCH_SIZE = originalEmbeddingBatchSize;
        }
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    async function createProject(): Promise<string> {
        const project = path.join(tempRoot, 'project');
        await fs.mkdir(project);
        await fs.writeFile(path.join(project, 'one.ts'), 'const one = 1;');
        await fs.writeFile(path.join(project, 'two.ts'), 'const two = 2;');
        return project;
    }

    it('propagates embedding API errors instead of treating them as file skips', async () => {
        process.env.EMBEDDING_BATCH_SIZE = '1';
        const project = await createProject();
        const vectorDatabase = createVectorDatabase();
        const context = new Context({
            embedding: new FailingEmbedding('throw'),
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });

        await expect(context.indexCodebase(project)).rejects.toThrow(EmbeddingError);
        expect(vectorDatabase.insert).not.toHaveBeenCalled();
        expect(vectorDatabase.insertHybrid).not.toHaveBeenCalled();
    });

    it('rejects empty embedding batches before inserting documents', async () => {
        const project = await createProject();
        const vectorDatabase = createVectorDatabase();
        const context = new Context({
            embedding: new FailingEmbedding('empty'),
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });

        await expect(context.indexCodebase(project)).rejects.toThrow('Embedding API returned 0 embeddings for 2 chunks');
        expect(vectorDatabase.insert).not.toHaveBeenCalled();
        expect(vectorDatabase.insertHybrid).not.toHaveBeenCalled();
    });

    it('rejects embedding batches that do not match the chunk count', async () => {
        const project = await createProject();
        const vectorDatabase = createVectorDatabase();
        const context = new Context({
            embedding: new FailingEmbedding('short'),
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });

        await expect(context.indexCodebase(project)).rejects.toThrow('Embedding API returned 1 embeddings for 2 chunks');
        expect(vectorDatabase.insert).not.toHaveBeenCalled();
        expect(vectorDatabase.insertHybrid).not.toHaveBeenCalled();
    });
});
