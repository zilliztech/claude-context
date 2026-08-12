import { execFileSync } from 'node:child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Context } from './context';
import { Embedding, EmbeddingVector } from './embedding';
import { Splitter, CodeChunk } from './splitter';
import { VectorDatabase } from './vectordb';

class TestEmbedding extends Embedding {
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

class PassthroughSplitter implements Splitter {
    async split(code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        return [{
            content: code,
            metadata: {
                startLine: 1,
                endLine: code.split('\n').length,
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

/** Comfortably past BASE_STALENESS_WARN_COMMITS so the notice must fire. */
const BASE_DRIFT_COMMITS = 12;

const git = (repo: string, ...args: string[]): string =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });

/** Paths passed to insert(), across every call, as repo-relative strings. */
const insertedPaths = (vectorDatabase: jest.Mocked<VectorDatabase>): string[] =>
    vectorDatabase.insert.mock.calls.flatMap(([, documents]) =>
        (documents as Array<{ relativePath: string }>).map(d => d.relativePath));

describe('Context lazy overlay refresh on search', () => {
    let tempRoot: string;
    let repo: string;
    let originalHome: string | undefined;
    let originalHybridMode: string | undefined;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-overlay-'));
        const homeDir = path.join(tempRoot, 'home');
        await fs.mkdir(homeDir, { recursive: true });
        originalHome = process.env.HOME;
        originalHybridMode = process.env.HYBRID_MODE;
        process.env.HOME = homeDir;
        process.env.HYBRID_MODE = 'false';

        repo = path.join(tempRoot, 'repo');
        await fs.mkdir(repo, { recursive: true });
        git(repo, 'init', '-b', 'main');
        git(repo, 'config', 'user.email', 'test@example.com');
        git(repo, 'config', 'user.name', 'Test');
        await fs.writeFile(path.join(repo, 'base.ts'), 'export const base = 1;\n');
        await fs.writeFile(path.join(repo, 'feature.ts'), 'export const feature = 1;\n');
        git(repo, 'add', '.');
        git(repo, 'commit', '-m', 'base');
        git(repo, 'checkout', '-b', 'feature');
    });

    afterEach(async () => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalHybridMode === undefined) delete process.env.HYBRID_MODE;
        else process.env.HYBRID_MODE = originalHybridMode;
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    const newContext = (vectorDatabase: jest.Mocked<VectorDatabase>) => new Context({
        embedding: new TestEmbedding(),
        vectorDatabase,
        codeSplitter: new PassthroughSplitter(),
    });

    it('indexes a file the branch touched before answering the search', async () => {
        await fs.writeFile(path.join(repo, 'feature.ts'), 'export const feature = 2;\n');
        const vectorDatabase = createVectorDatabase();

        await newContext(vectorDatabase).semanticSearch(repo, 'feature', 5, 0.5);

        expect(insertedPaths(vectorDatabase)).toEqual(['feature.ts']);
    });

    it('leaves an unchanged overlay alone on the next search', async () => {
        await fs.writeFile(path.join(repo, 'feature.ts'), 'export const feature = 2;\n');
        const vectorDatabase = createVectorDatabase();
        const context = newContext(vectorDatabase);

        await context.semanticSearch(repo, 'feature', 5, 0.5);
        vectorDatabase.insert.mockClear();
        await context.semanticSearch(repo, 'feature', 5, 0.5);

        expect(vectorDatabase.insert).not.toHaveBeenCalled();
    });

    it('re-indexes only the file that changed between searches', async () => {
        const featurePath = path.join(repo, 'feature.ts');
        const basePath = path.join(repo, 'base.ts');
        await fs.writeFile(featurePath, 'export const feature = 2;\n');
        await fs.writeFile(basePath, 'export const base = 2;\n');
        const vectorDatabase = createVectorDatabase();
        const context = newContext(vectorDatabase);

        await context.semanticSearch(repo, 'feature', 5, 0.5);
        vectorDatabase.insert.mockClear();
        await fs.writeFile(featurePath, 'export const feature = 3;\n');
        await context.semanticSearch(repo, 'feature', 5, 0.5);

        expect(insertedPaths(vectorDatabase)).toEqual(['feature.ts']);
    });

    it('survives a branch switch by re-deriving the touched set from git', async () => {
        await fs.writeFile(path.join(repo, 'feature.ts'), 'export const feature = 2;\n');
        const vectorDatabase = createVectorDatabase();
        const context = newContext(vectorDatabase);
        await context.semanticSearch(repo, 'feature', 5, 0.5);

        // A second branch touching a different file — the kind of event a
        // filesystem watcher would see as an unattributable storm of writes.
        git(repo, 'stash');
        git(repo, 'checkout', '-b', 'other');
        await fs.writeFile(path.join(repo, 'base.ts'), 'export const base = 3;\n');
        vectorDatabase.insert.mockClear();
        await context.semanticSearch(repo, 'base', 5, 0.5);

        expect(insertedPaths(vectorDatabase)).toEqual(['base.ts']);
    });

    it('drops branch rows for a file that no longer differs from base', async () => {
        const featurePath = path.join(repo, 'feature.ts');
        await fs.writeFile(featurePath, 'export const feature = 2;\n');
        const vectorDatabase = createVectorDatabase();
        const context = newContext(vectorDatabase);
        await context.semanticSearch(repo, 'feature', 5, 0.5);

        // Revert the edit: the file is identical to base again, so its branch rows
        // must go or they keep shadowing a base index that is already correct.
        vectorDatabase.query.mockResolvedValue([{ id: 'chunk-1' }]);
        await fs.writeFile(featurePath, 'export const feature = 1;\n');
        await context.semanticSearch(repo, 'feature', 5, 0.5);

        expect(vectorDatabase.delete).toHaveBeenCalledWith(expect.any(String), ['chunk-1']);
    });

    it('does not touch the index when CODEINDEX_LAZY_REFRESH=false', async () => {
        await fs.writeFile(path.join(repo, 'feature.ts'), 'export const feature = 2;\n');
        const vectorDatabase = createVectorDatabase();
        process.env.CODEINDEX_LAZY_REFRESH = 'false';
        try {
            await newContext(vectorDatabase).semanticSearch(repo, 'feature', 5, 0.5);
        } finally {
            delete process.env.CODEINDEX_LAZY_REFRESH;
        }

        expect(vectorDatabase.insert).not.toHaveBeenCalled();
    });

    it('declines to refresh an overlay larger than the inline bound', async () => {
        // 201 touched files: an unindexed or long-diverged worktree, which is an
        // indexing job rather than a freshness top-up.
        for (let i = 0; i < 201; i++) {
            await fs.writeFile(path.join(repo, `gen-${i}.ts`), `export const v${i} = 1;\n`);
        }
        const vectorDatabase = createVectorDatabase();
        const context = newContext(vectorDatabase);

        await context.semanticSearch(repo, 'anything', 5, 0.5);

        expect(vectorDatabase.insert).not.toHaveBeenCalled();
        expect(context.pendingOverlayNotice(repo)).toContain('201 changed files');
    });

    it('refreshes normally at the inline bound', async () => {
        for (let i = 0; i < 200; i++) {
            await fs.writeFile(path.join(repo, `gen-${i}.ts`), `export const v${i} = 1;\n`);
        }
        const vectorDatabase = createVectorDatabase();
        const context = newContext(vectorDatabase);

        await context.semanticSearch(repo, 'anything', 5, 0.5);

        expect(insertedPaths(vectorDatabase).length).toBe(200);
        expect(context.pendingOverlayNotice(repo)).toBeNull();
    });

    it('reports how far the base index has drifted from the base branch', async () => {
        const context = newContext(createVectorDatabase());
        // Stamp the base index at the current main, then move main forward.
        git(repo, 'checkout', 'main');
        await context.indexCodebase(repo);
        for (let i = 0; i < BASE_DRIFT_COMMITS; i++) {
            await fs.writeFile(path.join(repo, `later-${i}.ts`), `export const later = ${i};\n`);
            git(repo, 'add', '.');
            git(repo, 'commit', '-m', `later ${i}`);
        }

        expect(context.baseIndexDrift(repo)?.commits).toBe(BASE_DRIFT_COMMITS);
        expect(context.baseStalenessNotice(repo)).toContain(`${BASE_DRIFT_COMMITS} commits behind main`);
    });

    it('stays quiet while the base index is fresh', async () => {
        const context = newContext(createVectorDatabase());
        git(repo, 'checkout', 'main');
        await context.indexCodebase(repo);

        expect(context.baseIndexDrift(repo)?.commits).toBe(0);
        expect(context.baseStalenessNotice(repo)).toBeNull();
    });

    it('still answers the search when the refresh throws', async () => {
        await fs.writeFile(path.join(repo, 'feature.ts'), 'export const feature = 2;\n');
        const vectorDatabase = createVectorDatabase();
        vectorDatabase.insert.mockRejectedValue(new Error('milvus down'));

        await expect(
            newContext(vectorDatabase).semanticSearch(repo, 'feature', 5, 0.5)
        ).resolves.toEqual([]);
        expect(vectorDatabase.search).toHaveBeenCalled();
    });
});
