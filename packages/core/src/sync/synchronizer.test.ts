import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MerkleDAG } from './merkle';
import { FileSynchronizer } from './synchronizer';

type TestableFileSynchronizer = {
    snapshotPath: string;
    buildMerkleDAG(fileHashes: Map<string, string>): MerkleDAG;
};

describe('FileSynchronizer Merkle DAG', () => {
    it('uses stable root ids for identical file hashes inserted in different orders', () => {
        const synchronizer = new FileSynchronizer('/tmp/project') as unknown as TestableFileSynchronizer;
        const firstOrder = new Map([
            ['src/a.ts', 'hash-a'],
            ['src/b.ts', 'hash-b'],
            ['README.md', 'hash-readme'],
        ]);
        const secondOrder = new Map([
            ['README.md', 'hash-readme'],
            ['src/b.ts', 'hash-b'],
            ['src/a.ts', 'hash-a'],
        ]);

        const firstDag = synchronizer.buildMerkleDAG(firstOrder);
        const secondDag = synchronizer.buildMerkleDAG(secondOrder);

        expect(firstDag.rootIds).toEqual(secondDag.rootIds);
    });
});

describe('FileSynchronizer snapshots', () => {
    let tempRoot: string;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-synchronizer-'));
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await FileSynchronizer.deleteSnapshot(tempRoot);
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('persists only the file hashes and still detects changes after reloading', async () => {
        await fs.writeFile(path.join(tempRoot, 'a.ts'), 'export const a = 1;');
        await fs.writeFile(path.join(tempRoot, 'b.ts'), 'export const b = 2;');

        const synchronizer = new FileSynchronizer(tempRoot, [], ['.ts']);
        await synchronizer.initialize();

        const { snapshotPath } = synchronizer as unknown as TestableFileSynchronizer;
        const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
        expect(Object.keys(snapshot)).toEqual(['fileHashes']);
        expect(snapshot.fileHashes.map(([file]: [string, string]) => file).sort()).toEqual(['a.ts', 'b.ts']);

        await fs.writeFile(path.join(tempRoot, 'b.ts'), 'export const b = 3;');
        await fs.writeFile(path.join(tempRoot, 'c.ts'), 'export const c = 4;');

        const reloaded = new FileSynchronizer(tempRoot, [], ['.ts']);
        await reloaded.initialize();

        await expect(reloaded.checkForChanges()).resolves.toEqual({
            added: ['c.ts'],
            removed: [],
            modified: ['b.ts'],
        });
    });

    it('loads snapshots that still contain a serialized Merkle DAG', async () => {
        const content = 'export const a = 1;';
        await fs.writeFile(path.join(tempRoot, 'a.ts'), content);

        const synchronizer = new FileSynchronizer(tempRoot, [], ['.ts']);
        const testable = synchronizer as unknown as TestableFileSynchronizer;
        const fileHashes = new Map([
            ['a.ts', crypto.createHash('sha256').update(content).digest('hex')],
        ]);
        await fs.mkdir(path.dirname(testable.snapshotPath), { recursive: true });
        await fs.writeFile(testable.snapshotPath, JSON.stringify({
            fileHashes: Array.from(fileHashes.entries()),
            merkleDAG: testable.buildMerkleDAG(fileHashes).serialize(),
        }), 'utf-8');

        await synchronizer.initialize();

        expect(synchronizer.getFileHash('a.ts')).toBe(fileHashes.get('a.ts'));
        await expect(synchronizer.checkForChanges()).resolves.toEqual({
            added: [],
            removed: [],
            modified: [],
        });
    });
});
