import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Context } from './context';
import { Embedding, EmbeddingVector } from './embedding';
import { Splitter, CodeChunk } from './splitter';
import { FileSynchronizer } from './sync/synchronizer';
import { VectorDatabase } from './vectordb';

class TestEmbedding extends Embedding {
    protected maxTokens = 8192;

    async detectDimension(): Promise<number> {
        return 3;
    }

    async embed(text: string): Promise<EmbeddingVector> {
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

class TestSplitter implements Splitter {
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

describe('Context ignore pattern isolation', () => {
    let tempRoot: string;
    let originalHome: string | undefined;
    let originalHybridMode: string | undefined;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-ignore-'));
        const homeDir = path.join(tempRoot, 'home');
        await fs.mkdir(homeDir, { recursive: true });
        originalHome = process.env.HOME;
        originalHybridMode = process.env.HYBRID_MODE;
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
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('does not leak file-based ignore patterns between codebases', async () => {
        const projectA = path.join(tempRoot, 'project-a');
        const projectB = path.join(tempRoot, 'project-b');
        await fs.mkdir(projectA);
        await fs.mkdir(projectB);
        await fs.writeFile(path.join(projectA, '.contextignore'), '*.md\n');

        const context = new Context({ vectorDatabase: createVectorDatabase() });

        const projectAIgnores = await context.getEffectiveIgnorePatterns(projectA);
        expect(projectAIgnores).toContain('*.md');

        const projectBIgnores = await context.getEffectiveIgnorePatterns(projectB);
        expect(projectBIgnores).not.toContain('*.md');
    });

    it('does not leak request ignore patterns between calls', async () => {
        const project = path.join(tempRoot, 'project');
        await fs.mkdir(project);
        const context = new Context({ vectorDatabase: createVectorDatabase() });

        const withRequestIgnores = await context.getEffectiveIgnorePatterns(project, ['*.txt']);
        expect(withRequestIgnores).toContain('*.txt');

        const withoutRequestIgnores = await context.getEffectiveIgnorePatterns(project);
        expect(withoutRequestIgnores).not.toContain('*.txt');
    });

    it('does not leak request custom extensions into persistent supported extensions', () => {
        const context = new Context({ vectorDatabase: createVectorDatabase() });

        const withRequestExtensions = context.getEffectiveSupportedExtensions(['foo']);
        expect(withRequestExtensions).toContain('.foo');

        const withoutRequestExtensions = context.getSupportedExtensions();
        expect(withoutRequestExtensions).not.toContain('.foo');
    });

    it('does not leak request custom extensions between codebase indexes', async () => {
        const projectA = path.join(tempRoot, 'project-a');
        const projectB = path.join(tempRoot, 'project-b');
        await fs.mkdir(projectA);
        await fs.mkdir(projectB);
        await fs.writeFile(path.join(projectA, 'a.foo'), 'project a custom file');
        await fs.writeFile(path.join(projectB, 'b.foo'), 'project b custom file');

        const vectorDatabase = createVectorDatabase();
        const context = new Context({
            embedding: new TestEmbedding(),
            vectorDatabase,
            codeSplitter: new TestSplitter(),
        });

        await context.indexCodebase(projectA, undefined, false, [], ['foo']);
        expect(vectorDatabase.insert).toHaveBeenCalledTimes(1);
        expect(vectorDatabase.insert.mock.calls[0][1][0].relativePath).toBe('a.foo');

        vectorDatabase.insert.mockClear();

        await context.indexCodebase(projectB);
        expect(vectorDatabase.insert).not.toHaveBeenCalled();
    });

    it('uses request options when recreating a synchronizer for change indexing', async () => {
        const project = path.join(tempRoot, 'project-with-options');
        await fs.mkdir(project);
        await fs.writeFile(path.join(project, 'custom.foo'), 'custom extension file');
        await fs.writeFile(path.join(project, 'ignored.ts'), 'ignored by request pattern');

        const context = new Context({ vectorDatabase: createVectorDatabase() });

        try {
            await context.reindexByChange(project, undefined, ['*.ts'], ['foo']);

            const collectionName = context.getCollectionName(project);
            const synchronizer = context.getSynchronizers().get(collectionName);

            expect(synchronizer).toBeDefined();
            expect(synchronizer?.getFileHash('custom.foo')).toBeDefined();
            expect(synchronizer?.getFileHash('ignored.ts')).toBeUndefined();
            expect(context.getSupportedExtensions()).not.toContain('.foo');
        } finally {
            await FileSynchronizer.deleteSnapshot(project);
        }
    });

    it('treats leading-slash directory ignore patterns as root-anchored and recursive during indexing', async () => {
        const project = path.join(tempRoot, 'project');
        await fs.mkdir(path.join(project, 'Library'), { recursive: true });
        await fs.mkdir(path.join(project, 'src', 'Library'), { recursive: true });
        await fs.writeFile(path.join(project, '.gitignore'), '/Library/\n');
        await fs.writeFile(path.join(project, 'Library', 'generated.md'), 'root library should be ignored');
        await fs.writeFile(path.join(project, 'src', 'Library', 'nested.md'), 'nested library should stay');
        await fs.writeFile(path.join(project, 'src', 'keep.md'), 'regular file should stay');

        const vectorDatabase = createVectorDatabase();
        const context = new Context({
            embedding: new TestEmbedding(),
            vectorDatabase,
            codeSplitter: new TestSplitter(),
        });

        await context.indexCodebase(project);

        const insertedDocuments = vectorDatabase.insert.mock.calls
            .flatMap(([, documents]) => documents);
        const indexedPaths = insertedDocuments
            .map(document => document.relativePath.replace(/\\/g, '/'))
            .sort();

        expect(indexedPaths).toEqual([
            'src/Library/nested.md',
            'src/keep.md',
        ]);
    });

    it('treats leading-slash directory ignore patterns as root-anchored and recursive during sync', async () => {
        const project = path.join(tempRoot, 'project');
        await fs.mkdir(path.join(project, 'Library'), { recursive: true });
        await fs.mkdir(path.join(project, 'src', 'Library'), { recursive: true });
        await fs.writeFile(path.join(project, 'Library', 'generated.md'), 'root library should be ignored');
        await fs.writeFile(path.join(project, 'src', 'Library', 'nested.md'), 'nested library should stay');
        await fs.writeFile(path.join(project, 'src', 'keep.md'), 'regular file should stay');

        const synchronizer = new FileSynchronizer(project, ['/Library/'], ['.md']);
        const fileHashes = await (synchronizer as any).generateFileHashes(project) as Map<string, string>;

        expect(fileHashes.has(path.join('Library', 'generated.md'))).toBe(false);
        expect(fileHashes.has(path.join('src', 'Library', 'nested.md'))).toBe(true);
        expect(fileHashes.has(path.join('src', 'keep.md'))).toBe(true);
    });
});
