import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSynchronizer, type Context } from "@zilliz/claude-context-core";

import type { CodebaseInfo, CodebaseInfoIndexed, CodebaseSnapshotV2 } from "./config.js";
import { ToolHandlers } from "./handlers.js";
import { SnapshotManager } from "./snapshot.js";
import { SyncManager } from "./sync.js";

const STALE_TIMESTAMP = "2020-01-01T00:00:00.000Z";
const INITIAL_CHUNKS: Record<string, number> = { "a.ts": 2, "b.ts": 4, "c.ts": 3 };

interface Fixture {
    /** The codebase the tests change and sync: three files, 9 chunks. */
    codebasePath: string;
    /** A second indexed codebase that never changes. */
    otherCodebasePath: string;
    snapshot: SnapshotManager;
    sync: SyncManager;
    handlers: ToolHandlers;
    /** Set to -1 to emulate a vector database that cannot count rows. */
    rowCountOverride: number | null;
    rowCountCalls: number;
    /** Runs inside reindexByChange, after the changes were applied. */
    duringReindex: () => void;
    /** Reads an entry straight from the snapshot file. */
    readDiskEntry: (codebasePath: string) => CodebaseInfo | undefined;
}

/**
 * Index two codebases with a real FileSynchronizer for the synced one and a
 * fake vector database whose row count follows the chunks of tracked files.
 */
async function withFixture(
    indexStatus: "completed" | "limit_reached",
    run: (fixture: Fixture) => Promise<void>
): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mcp-sync-stats-"));
    const homeDir = path.join(tempRoot, "home");
    const codebasePath = path.join(tempRoot, "repo");
    const otherCodebasePath = path.join(tempRoot, "other");
    await mkdir(homeDir);
    await mkdir(codebasePath);
    await mkdir(otherCodebasePath);
    for (const file of Object.keys(INITIAL_CHUNKS)) {
        await writeFile(path.join(codebasePath, file), `export const name = "${file}";\n`);
    }

    // Redirect ~/.context (snapshot, merkle files, locks) for core and mcp alike.
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    try {
        const collectionName = "hybrid_code_chunks_sync_stats_test";
        const synchronizer = new FileSynchronizer(codebasePath, [], [".ts"]);
        await synchronizer.initialize();
        const chunksByFile = new Map(Object.entries(INITIAL_CHUNKS));

        const snapshot = new SnapshotManager();
        snapshot.setCodebaseIndexed(otherCodebasePath, { indexedFiles: 1, totalChunks: 1, status: "completed" });
        snapshot.setCodebaseIndexed(
            codebasePath,
            { indexedFiles: 3, totalChunks: 9, status: indexStatus },
            { requestSplitter: "langchain" }
        );
        (snapshot.getCodebaseInfo(codebasePath) as CodebaseInfoIndexed).lastUpdated = STALE_TIMESTAMP;
        snapshot.saveCodebaseSnapshot();
        const snapshotFile = path.join(homeDir, ".context", "mcp-codebase-snapshot.json");

        // The fakes below only read the fixture once the test runs.
        let fixture!: Fixture;
        const database = {
            listCollections: async () => [],
            getCollectionRowCount: async () => {
                fixture.rowCountCalls++;
                return fixture.rowCountOverride
                    ?? [...chunksByFile.values()].reduce((sum, chunks) => sum + chunks, 0);
            }
        };
        const context = {
            getCollectionName: (codebase: string) =>
                codebase === codebasePath ? collectionName : `${collectionName}_other`,
            getVectorDatabase: () => database,
            getSynchronizers: () => new Map([[collectionName, synchronizer]]),
            reindexByChange: async (codebase: string) => {
                if (codebase !== codebasePath) {
                    return { added: 0, removed: 0, modified: 0 };
                }
                const { added, removed, modified } = await synchronizer.checkForChanges();
                for (const file of removed) chunksByFile.delete(file);
                for (const file of [...added, ...modified]) chunksByFile.set(file, 1);
                fixture.duringReindex();
                return { added: added.length, removed: removed.length, modified: modified.length };
            }
        } as unknown as Context;

        fixture = {
            codebasePath,
            otherCodebasePath,
            snapshot,
            sync: new SyncManager(context, snapshot),
            handlers: new ToolHandlers(context, snapshot),
            rowCountOverride: null,
            rowCountCalls: 0,
            duringReindex: () => {},
            readDiskEntry: codebase =>
                (JSON.parse(readFileSync(snapshotFile, "utf8")) as CodebaseSnapshotV2).codebases[codebase]
        };
        await run(fixture);
    } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        await rm(tempRoot, { recursive: true, force: true });
    }
}

/** A second MCP server process sharing the same snapshot file. */
function startOtherProcess(): SnapshotManager {
    const snapshot = new SnapshotManager();
    snapshot.loadCodebaseSnapshot();
    return snapshot;
}

function indexedInfo(info: CodebaseInfo | undefined): CodebaseInfoIndexed {
    assert.equal(info?.status, "indexed");
    return info as CodebaseInfoIndexed;
}

function diskStatus(fixture: Fixture, codebasePath: string): string {
    return fixture.readDiskEntry(codebasePath)?.status ?? "not_found";
}

test("sync with changes refreshes and persists the snapshot stats", async () => {
    await withFixture("completed", async ({ codebasePath, snapshot, sync, handlers, readDiskEntry }) => {
        await unlink(path.join(codebasePath, "b.ts"));
        await sync.handleSyncIndex();

        const info = indexedInfo(snapshot.getCodebaseInfo(codebasePath));
        assert.equal(info.indexedFiles, 2);
        assert.equal(info.totalChunks, 5);
        assert.equal(info.indexStatus, "completed");
        assert.equal(info.requestSplitter, "langchain");
        assert.notEqual(info.lastUpdated, STALE_TIMESTAMP);
        assert.deepEqual(readDiskEntry(codebasePath), info);

        const status = await handlers.handleGetIndexingStatus({ path: codebasePath });
        assert.match(status.content[0].text, /2 files, 5 chunks/);
    });
});

test("sync keeps the previous chunk count when the row count is unknown", async () => {
    await withFixture("completed", async fixture => {
        fixture.rowCountOverride = -1;
        await writeFile(path.join(fixture.codebasePath, "d.ts"), "export const d = 4;\n");
        await fixture.sync.handleSyncIndex();

        const info = indexedInfo(fixture.snapshot.getCodebaseInfo(fixture.codebasePath));
        assert.equal(info.indexedFiles, 4);
        assert.equal(info.totalChunks, 9);
        assert.notEqual(info.lastUpdated, STALE_TIMESTAMP);
    });
});

test("sync keeps the file count of a limit_reached index", async () => {
    await withFixture("limit_reached", async ({ codebasePath, snapshot, sync }) => {
        await unlink(path.join(codebasePath, "b.ts"));
        await sync.handleSyncIndex();

        const info = indexedInfo(snapshot.getCodebaseInfo(codebasePath));
        assert.equal(info.indexedFiles, 3);
        assert.equal(info.totalChunks, 5);
        assert.equal(info.indexStatus, "limit_reached");
    });
});

test("sync without changes leaves the snapshot stats alone", async () => {
    await withFixture("completed", async fixture => {
        await fixture.sync.handleSyncIndex();

        const info = indexedInfo(fixture.snapshot.getCodebaseInfo(fixture.codebasePath));
        assert.equal(info.indexedFiles, 3);
        assert.equal(info.totalChunks, 9);
        assert.equal(info.lastUpdated, STALE_TIMESTAMP);
        assert.equal(fixture.rowCountCalls, 0);
    });
});

const transitions = [
    { name: "clear", status: "not_found", apply: (s: SnapshotManager, p: string) => s.removeCodebaseCompletely(p) },
    { name: "force re-index", status: "indexing", apply: (s: SnapshotManager, p: string) => s.setCodebaseIndexing(p, 40) }
] as const;

for (const transition of transitions) {
    test(`sync keeps a ${transition.name} made in this process during the sync`, async () => {
        await withFixture("completed", async fixture => {
            fixture.duringReindex = () => {
                transition.apply(fixture.snapshot, fixture.codebasePath);
                fixture.snapshot.saveCodebaseSnapshot();
            };
            await unlink(path.join(fixture.codebasePath, "b.ts"));
            await fixture.sync.handleSyncIndex();

            assert.equal(fixture.snapshot.getCodebaseStatus(fixture.codebasePath), transition.status);
            assert.equal(diskStatus(fixture, fixture.codebasePath), transition.status);
        });
    });

    test(`sync keeps a ${transition.name} made by another process during the sync`, async () => {
        await withFixture("completed", async fixture => {
            fixture.duringReindex = () => {
                const other = startOtherProcess();
                transition.apply(other, fixture.codebasePath);
                other.saveCodebaseSnapshot();
            };
            await unlink(path.join(fixture.codebasePath, "b.ts"));
            await fixture.sync.handleSyncIndex();

            assert.equal(diskStatus(fixture, fixture.codebasePath), transition.status);
        });
    });

    test(`sync keeps another process's ${transition.name} of a different codebase`, async () => {
        await withFixture("completed", async fixture => {
            const other = startOtherProcess();
            transition.apply(other, fixture.otherCodebasePath);
            other.saveCodebaseSnapshot();

            await unlink(path.join(fixture.codebasePath, "b.ts"));
            await fixture.sync.handleSyncIndex();

            assert.equal(diskStatus(fixture, fixture.otherCodebasePath), transition.status);
            assert.equal(indexedInfo(fixture.readDiskEntry(fixture.codebasePath)).totalChunks, 5);
        });
    });
}

test("sync keeps the stats another process wrote during the sync", async () => {
    await withFixture("completed", async fixture => {
        fixture.duringReindex = () => {
            const other = startOtherProcess();
            other.setCodebaseIndexed(fixture.codebasePath, { indexedFiles: 10, totalChunks: 20, status: "completed" });
            other.saveCodebaseSnapshot();
        };
        await unlink(path.join(fixture.codebasePath, "b.ts"));
        await fixture.sync.handleSyncIndex();

        const persisted = indexedInfo(fixture.readDiskEntry(fixture.codebasePath));
        assert.equal(persisted.indexedFiles, 10);
        assert.equal(persisted.totalChunks, 20);
    });
});
