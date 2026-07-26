import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { Context } from './context';
import { VectorDatabase } from './vectordb';

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

async function writeGitOriginConfig(repoDir: string, url: string): Promise<void> {
    const gitDir = path.join(repoDir, '.git');
    await fs.mkdir(gitDir, { recursive: true });
    const config = [
        '[core]',
        '\trepositoryformatversion = 0',
        '[remote "origin"]',
        `\turl = ${url}`,
        '\tfetch = +refs/heads/*:refs/remotes/origin/*',
        '[branch "main"]',
        '\tremote = origin',
        '\tmerge = refs/heads/main',
        ''
    ].join('\n');
    await fs.writeFile(path.join(gitDir, 'config'), config, 'utf-8');
}

describe('Context.getCollectionName with CODE_CHUNKS_COLLECTION_KEY_SOURCE=git-remote', () => {
    let tempRoot: string;
    let originalKeySource: string | undefined;
    let originalHybridMode: string | undefined;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-git-remote-'));
        originalKeySource = process.env.CODE_CHUNKS_COLLECTION_KEY_SOURCE;
        originalHybridMode = process.env.HYBRID_MODE;
        process.env.HYBRID_MODE = 'false';
    });

    afterEach(async () => {
        if (originalKeySource === undefined) {
            delete process.env.CODE_CHUNKS_COLLECTION_KEY_SOURCE;
        } else {
            process.env.CODE_CHUNKS_COLLECTION_KEY_SOURCE = originalKeySource;
        }
        if (originalHybridMode === undefined) {
            delete process.env.HYBRID_MODE;
        } else {
            process.env.HYBRID_MODE = originalHybridMode;
        }
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    test('defaults to path-based hashing when the env var is unset', async () => {
        delete process.env.CODE_CHUNKS_COLLECTION_KEY_SOURCE;
        const repoA = path.join(tempRoot, 'checkout-a');
        const repoB = path.join(tempRoot, 'checkout-b');
        await fs.mkdir(repoA, { recursive: true });
        await fs.mkdir(repoB, { recursive: true });
        await writeGitOriginConfig(repoA, 'git@github.com:acme/widgets.git');
        await writeGitOriginConfig(repoB, 'git@github.com:acme/widgets.git');

        const context = new Context({ vectorDatabase: createVectorDatabase() });

        expect(context.getCollectionName(repoA)).not.toBe(context.getCollectionName(repoB));
    });

    test('SSH and HTTPS remotes for the same repo converge on the same collection name', async () => {
        process.env.CODE_CHUNKS_COLLECTION_KEY_SOURCE = 'git-remote';
        const repoSsh = path.join(tempRoot, 'checkout-ssh');
        const repoHttps = path.join(tempRoot, 'checkout-https');
        await fs.mkdir(repoSsh, { recursive: true });
        await fs.mkdir(repoHttps, { recursive: true });
        await writeGitOriginConfig(repoSsh, 'git@github.com:acme/widgets.git');
        await writeGitOriginConfig(repoHttps, 'https://github.com/acme/widgets.git');

        const context = new Context({ vectorDatabase: createVectorDatabase() });

        expect(context.getCollectionName(repoSsh)).toBe(context.getCollectionName(repoHttps));
    });

    test('different repos still get different collection names', async () => {
        process.env.CODE_CHUNKS_COLLECTION_KEY_SOURCE = 'git-remote';
        const repoA = path.join(tempRoot, 'checkout-a');
        const repoB = path.join(tempRoot, 'checkout-b');
        await fs.mkdir(repoA, { recursive: true });
        await fs.mkdir(repoB, { recursive: true });
        await writeGitOriginConfig(repoA, 'git@github.com:acme/widgets.git');
        await writeGitOriginConfig(repoB, 'git@github.com:acme/gizmos.git');

        const context = new Context({ vectorDatabase: createVectorDatabase() });

        expect(context.getCollectionName(repoA)).not.toBe(context.getCollectionName(repoB));
    });

    test('falls back to path-based hashing when there is no git repo', async () => {
        process.env.CODE_CHUNKS_COLLECTION_KEY_SOURCE = 'git-remote';
        const notARepo = path.join(tempRoot, 'plain-folder');
        await fs.mkdir(notARepo, { recursive: true });

        const context = new Context({ vectorDatabase: createVectorDatabase() });

        const expectedHash = crypto.createHash('md5').update(path.resolve(notARepo)).digest('hex').substring(0, 8);
        expect(context.getCollectionName(notARepo)).toBe(`code_chunks_${expectedHash}`);
    });
});
