import * as crypto from 'crypto';
import { Context } from './context';
import { Embedding, EmbeddingVector } from './embedding';
import { VectorDatabase } from './vectordb';

// Mock child_process at module level so the import inside context.ts is intercepted
jest.mock('child_process', () => ({
    execSync: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execSync } = require('child_process') as { execSync: jest.Mock };

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class TestEmbedding extends Embedding {
    protected maxTokens = 8192;
    async detectDimension(): Promise<number> { return 3; }
    async embed(_text: string): Promise<EmbeddingVector> { return { vector: [1, 0, 0], dimension: 3 }; }
    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> { return texts.map(() => ({ vector: [1, 0, 0], dimension: 3 })); }
    getDimension(): number { return 3; }
    getProvider(): string { return 'test'; }
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
    query: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(undefined),
    getCollectionDescription: jest.fn().mockResolvedValue(''),
    checkCollectionLimit: jest.fn().mockResolvedValue(true),
    getCollectionRowCount: jest.fn().mockResolvedValue(0),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex').substring(0, 8);
}

function makeContext(): Context {
    return new Context({ embedding: new TestEmbedding(), vectorDatabase: createVectorDatabase() });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getCollectionName — git-remote shared index', () => {
    const originalEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
        execSync.mockReset();
        for (const key of ['CLAUDE_CONTEXT_GIT_REMOTE_COLLECTION', 'CODE_CHUNKS_COLLECTION_NAME_OVERRIDE', 'HYBRID_MODE']) {
            originalEnv[key] = process.env[key];
            delete process.env[key];
        }
        // Disable hybrid mode so prefix is predictable ('code_chunks')
        process.env.HYBRID_MODE = 'false';
    });

    afterEach(() => {
        for (const [key, val] of Object.entries(originalEnv)) {
            if (val === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = val;
            }
        }
    });

    it('uses git remote origin hash when a remote is found (default behaviour)', () => {
        execSync.mockReturnValue(Buffer.from('https://github.com/org/repo.git'));

        const ctx = makeContext();
        const name = ctx.getCollectionName('/some/local/path');

        // Normalised URL → 'github.com/org/repo'
        const expectedHash = md5('github.com/org/repo');
        expect(name).toBe(`code_chunks_git_${expectedHash}`);
        expect(execSync).toHaveBeenCalledWith(
            'git remote get-url origin',
            expect.objectContaining({ cwd: '/some/local/path' }),
        );
    });

    it('falls back to path hash when execSync throws (not a git repo)', () => {
        execSync.mockImplementation(() => { throw new Error('not a git repo'); });

        const ctx = makeContext();
        const absPath = '/non/git/path';
        const name = ctx.getCollectionName(absPath);

        const pathHash = md5(absPath);
        expect(name).toBe(`code_chunks_${pathHash}`);
    });

    it('falls back to path hash when CLAUDE_CONTEXT_GIT_REMOTE_COLLECTION=false', () => {
        process.env.CLAUDE_CONTEXT_GIT_REMOTE_COLLECTION = 'false';
        execSync.mockReturnValue(Buffer.from('https://github.com/org/repo.git'));

        const ctx = makeContext();
        const absPath = '/some/local/path';
        const name = ctx.getCollectionName(absPath);

        const pathHash = md5(absPath);
        expect(name).toBe(`code_chunks_${pathHash}`);
        expect(execSync).not.toHaveBeenCalled();
    });

    it('CODE_CHUNKS_COLLECTION_NAME_OVERRIDE takes precedence over git remote', () => {
        process.env.CODE_CHUNKS_COLLECTION_NAME_OVERRIDE = 'myproject';
        execSync.mockReturnValue(Buffer.from('https://github.com/org/repo.git'));

        const ctx = makeContext();
        const name = ctx.getCollectionName('/some/local/path');

        expect(name).toMatch(/^code_chunks_myproject_/);
        expect(execSync).not.toHaveBeenCalled();
    });

    it('caches the git remote URL per path to avoid repeated execSync calls', () => {
        execSync.mockReturnValue(Buffer.from('https://github.com/org/repo.git'));

        const ctx = makeContext();
        ctx.getCollectionName('/some/local/path');
        ctx.getCollectionName('/some/local/path');
        ctx.getCollectionName('/some/local/path');

        expect(execSync).toHaveBeenCalledTimes(1);
    });

    describe('remote URL normalisation', () => {
        const cases: Array<[string, string]> = [
            ['https://github.com/org/repo.git', 'github.com/org/repo'],
            ['https://github.com/org/repo',     'github.com/org/repo'],
            ['git@github.com:org/repo.git',     'github.com/org/repo'],
            ['git@github.com:org/repo',         'github.com/org/repo'],
            ['ssh://git@github.com/org/repo.git', 'github.com/org/repo'],
            ['https://GITHUB.COM/Org/Repo.git', 'github.com/org/repo'],
        ];

        test.each(cases)('%s → %s', (remoteUrl, normalised) => {
            execSync.mockReturnValue(Buffer.from(remoteUrl));

            const ctx = makeContext();
            const name = ctx.getCollectionName('/some/path');
            const expectedHash = md5(normalised);

            expect(name).toBe(`code_chunks_git_${expectedHash}`);
        });

        it('produces the same collection name for SSH and HTTPS variants', () => {
            const https = 'https://github.com/org/repo.git';
            const ssh   = 'git@github.com:org/repo.git';

            execSync.mockReturnValueOnce(Buffer.from(https));
            const ctxHttps = makeContext();
            const nameHttps = ctxHttps.getCollectionName('/path/a');

            execSync.mockReturnValueOnce(Buffer.from(ssh));
            const ctxSsh = makeContext();
            const nameSsh = ctxSsh.getCollectionName('/path/b');

            expect(nameHttps).toBe(nameSsh);
        });
    });
});

describe('getCanonicalKey', () => {
    const originalEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
        execSync.mockReset();
        for (const key of ['CLAUDE_CONTEXT_GIT_REMOTE_COLLECTION', 'HYBRID_MODE']) {
            originalEnv[key] = process.env[key];
            delete process.env[key];
        }
        process.env.HYBRID_MODE = 'false';
    });

    afterEach(() => {
        for (const [key, val] of Object.entries(originalEnv)) {
            if (val === undefined) delete process.env[key];
            else process.env[key] = val;
        }
    });

    it('returns the normalised remote URL for a git repo', () => {
        execSync.mockReturnValue(Buffer.from('git@github.com:org/repo.git'));
        const ctx = makeContext();
        expect(ctx.getCanonicalKey('/some/local/path')).toBe('github.com/org/repo');
    });

    it('returns the absolute path when no remote is found', () => {
        execSync.mockImplementation(() => { throw new Error('not a git repo'); });
        const ctx = makeContext();
        expect(ctx.getCanonicalKey('/non/git/path')).toBe('/non/git/path');
    });

    it('returns the absolute path when git-remote collection is disabled', () => {
        process.env.CLAUDE_CONTEXT_GIT_REMOTE_COLLECTION = 'false';
        execSync.mockReturnValue(Buffer.from('https://github.com/org/repo.git'));
        const ctx = makeContext();
        expect(ctx.getCanonicalKey('/some/local/path')).toBe('/some/local/path');
    });

    it('is consistent with the git-hash part of getCollectionName', () => {
        execSync.mockReturnValue(Buffer.from('https://github.com/org/repo.git'));
        const ctx = makeContext();
        const canonKey = ctx.getCanonicalKey('/some/local/path');
        const collectionName = ctx.getCollectionName('/some/local/path');
        // collectionName = code_chunks_git_<md5(canonKey)>
        expect(collectionName).toContain('_git_');
        const hash = crypto.createHash('md5').update(canonKey).digest('hex').substring(0, 8);
        expect(collectionName).toBe(`code_chunks_git_${hash}`);
    });
});
