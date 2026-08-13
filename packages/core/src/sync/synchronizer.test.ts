import { FileSynchronizer } from './synchronizer';

type TestableFileSynchronizer = {
    buildMerkleDAG(fileHashes: Map<string, string>): {
        rootIds: string[];
    };
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
