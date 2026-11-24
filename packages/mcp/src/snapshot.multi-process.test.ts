import assert from "node:assert/strict";
import fs, { readFileSync, writeFileSync, type PathLike } from "node:fs";
import { mkdtemp, mkdir, rm, rmdir } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Context } from "@zilliz/claude-context-core";

import type { CodebaseIndexOptions, CodebaseInfo, CodebaseInfoIndexed, CodebaseSnapshotV2 } from "./config.js";
import { ToolHandlers } from "./handlers.js";
import { SnapshotManager } from "./snapshot.js";

const STALE_TIMESTAMP = "2020-01-01T00:00:00.000Z";
const NEW_OPTIONS: CodebaseIndexOptions = {
    requestSplitter: "ast",
    requestCustomExtensions: [".vue"],
    requestIgnorePatterns: ["dist/**"]
};

/**
 * Every agent session runs its own MCP server, and all of them share
 * ~/.context/mcp-codebase-snapshot.json. `a` is this process, `b` another one.
 */
interface Fixture {
    /** Indexed before both processes start: 3 files, 9 chunks, langchain splitter. */
    shared: string;
    /** Codebases no process has indexed yet. */
    repoA: string;
    repoB: string;
    a: SnapshotManager;
    b: SnapshotManager;
    /** Starts one more MCP server process on the snapshot file. */
    startProcess: () => SnapshotManager;
    snapshotFile: string;
    /** Reads an entry straight from the snapshot file. */
    readDiskEntry: (codebasePath: string) => CodebaseInfo | undefined;
}

async function withTwoProcesses(run: (fixture: Fixture) => Promise<void>): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mcp-snapshot-processes-"));
    const homeDir = path.join(tempRoot, "home");
    const shared = path.join(tempRoot, "shared");
    const repoA = path.join(tempRoot, "repo-a");
    const repoB = path.join(tempRoot, "repo-b");
    // No ~/.context yet: the first save creates it.
    for (const directory of [homeDir, shared, repoA, repoB]) {
        await mkdir(directory);
    }

    // Redirect ~/.context for every SnapshotManager created below.
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    try {
        const setup = new SnapshotManager();
        setup.setCodebaseIndexed(
            shared,
            { indexedFiles: 3, totalChunks: 9, status: "completed" },
            { requestSplitter: "langchain" }
        );
        // Older than any later write, for the revision check of updateIndexedStats().
        (setup.getCodebaseInfo(shared) as CodebaseInfoIndexed).lastUpdated = STALE_TIMESTAMP;
        setup.saveCodebaseSnapshot();

        const snapshotFile = path.join(homeDir, ".context", "mcp-codebase-snapshot.json");
        const startProcess = () => {
            const snapshot = new SnapshotManager();
            snapshot.loadCodebaseSnapshot();
            return snapshot;
        };
        await run({
            shared,
            repoA,
            repoB,
            a: startProcess(),
            b: startProcess(),
            startProcess,
            snapshotFile,
            readDiskEntry: codebasePath =>
                (JSON.parse(readFileSync(snapshotFile, "utf8")) as CodebaseSnapshotV2).codebases[codebasePath]
        });
    } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        await rm(tempRoot, { recursive: true, force: true });
    }
}

function indexed(info: CodebaseInfo | undefined): CodebaseInfoIndexed {
    assert.equal(info?.status, "indexed");
    return info as CodebaseInfoIndexed;
}

/** Just enough of Context for index_codebase and get_indexing_status. */
function createContext(): Context {
    const database = {
        listCollections: async () => [],
        checkCollectionLimit: async () => true
    };
    return {
        getVectorDatabase: () => database,
        hasIndex: async () => false,
        getEffectiveIgnorePatterns: async () => [],
        getEffectiveSupportedExtensions: () => [".ts"],
        getPreparedCollection: async () => {},
        getCollectionName: () => "hybrid_code_chunks_multi_process_test",
        setSynchronizer: () => {},
        getEmbedding: () => ({ getProvider: () => "test", getDimension: () => 1 }),
        indexCodebase: async () => ({ indexedFiles: 1, totalChunks: 2, status: "completed" as const })
    } as unknown as Context;
}

const otherProcessChanges = [
    {
        name: "clear",
        apply(snapshot: SnapshotManager, codebasePath: string) {
            snapshot.removeCodebaseCompletely(codebasePath);
            snapshot.saveCodebaseSnapshot();
        }
    },
    {
        name: "completed re-index",
        apply(snapshot: SnapshotManager, codebasePath: string) {
            snapshot.setCodebaseIndexing(codebasePath, 0, NEW_OPTIONS);
            snapshot.saveCodebaseSnapshot();
            snapshot.setCodebaseIndexed(
                codebasePath,
                { indexedFiles: 10, totalChunks: 20, status: "completed" },
                NEW_OPTIONS
            );
            snapshot.saveCodebaseSnapshot();
        }
    },
    {
        name: "forced re-index still in progress",
        apply(snapshot: SnapshotManager, codebasePath: string) {
            // What index_codebase does with force=true.
            snapshot.removeCodebaseCompletely(codebasePath);
            snapshot.saveCodebaseSnapshot();
            snapshot.setCodebaseIndexing(codebasePath, 0, NEW_OPTIONS);
            snapshot.saveCodebaseSnapshot();
            snapshot.setCodebaseIndexing(codebasePath, 40);
            snapshot.saveCodebaseSnapshot();
        }
    }
];

for (const change of otherProcessChanges) {
    test(`a ${change.name} in another process survives a later save in this one`, async () => {
        await withTwoProcesses(async ({ shared, repoA, a, b, readDiskEntry }) => {
            const before = readDiskEntry(shared);
            change.apply(b, shared);
            const changed = readDiskEntry(shared);
            assert.notDeepEqual(changed, before);

            // This process saves a change to another codebase.
            a.setCodebaseIndexing(repoA, 0);
            a.saveCodebaseSnapshot();

            assert.deepEqual(readDiskEntry(shared), changed);
            assert.equal(readDiskEntry(repoA)?.status, "indexing");
            // Status reads in this process report the other process's change.
            assert.deepEqual(a.getCodebaseInfo(shared), changed);
        });
    });
}

test("index_codebase in this process keeps a codebase another process cleared", async () => {
    await withTwoProcesses(async ({ shared, repoA, a, b, readDiskEntry }) => {
        // clear_index in another session, after it dropped the collection.
        b.removeCodebaseCompletely(shared);
        b.saveCodebaseSnapshot();

        const handlers = new ToolHandlers(createContext(), a);
        const response = await handlers.handleIndexCodebase({ path: repoA });
        assert.equal(response.isError, undefined, response.content[0].text);
        const task = (handlers as any).indexingTasks.get(repoA);
        assert.ok(task);
        await task.promise;

        assert.equal(readDiskEntry(shared), undefined);
        assert.equal(indexed(readDiskEntry(repoA)).totalChunks, 2);
    });
});

test("get_indexing_status in this process reports stats another process refreshed", async () => {
    await withTwoProcesses(async ({ shared, a, b }) => {
        // The background sync of the other process refreshed the stats.
        const refreshed = b.updateIndexedStats(shared, indexed(b.getCodebaseInfo(shared)), {
            indexedFiles: 4,
            totalChunks: 11
        });
        assert.equal(refreshed, true);

        const handlers = new ToolHandlers(createContext(), a);
        const status = await handlers.handleGetIndexingStatus({ path: shared });
        assert.match(status.content[0].text, /4 files, 11 chunks/);
    });
});

test("this process's own changes persist next to another process's", async () => {
    await withTwoProcesses(async ({ shared, repoA, repoB, a, b, readDiskEntry }) => {
        // Another process re-indexes the shared codebase and indexes a new one.
        b.setCodebaseIndexed(shared, { indexedFiles: 10, totalChunks: 20, status: "completed" });
        b.setCodebaseIndexed(repoB, { indexedFiles: 1, totalChunks: 1, status: "completed" });
        b.saveCodebaseSnapshot();
        const repoBEntry = readDiskEntry(repoB);

        // Then this process clears the shared codebase and indexes its own.
        a.removeCodebaseCompletely(shared);
        a.setCodebaseIndexed(repoA, { indexedFiles: 2, totalChunks: 4, status: "completed" }, NEW_OPTIONS);
        a.saveCodebaseSnapshot();

        assert.equal(readDiskEntry(shared), undefined);
        assert.deepEqual(readDiskEntry(repoA), a.getCodebaseInfo(repoA));
        assert.deepEqual(indexed(readDiskEntry(repoA)).requestIgnorePatterns, ["dist/**"]);
        assert.deepEqual(readDiskEntry(repoB), repoBEntry);

        assert.equal(b.getCodebaseStatus(shared), "not_found");
        assert.deepEqual(b.getCodebaseInfo(repoA), readDiskEntry(repoA));
    });
});

test("a removal stays out of this process's view until saved, and only until then", async () => {
    await withTwoProcesses(async ({ shared, a, b, readDiskEntry }) => {
        a.removeCodebaseCompletely(shared);
        // The file still lists the codebase; reading it must not bring the codebase back.
        assert.equal(readDiskEntry(shared)?.status, "indexed");
        assert.equal(a.getCodebaseStatus(shared), "not_found");
        assert.equal(a.findTrackedCodebasePath(shared), undefined);

        a.saveCodebaseSnapshot();
        assert.equal(readDiskEntry(shared), undefined);

        // Once saved, the removal no longer hides another process's changes.
        b.setCodebaseIndexing(shared, 10);
        b.saveCodebaseSnapshot();
        assert.equal(a.getCodebaseStatus(shared), "indexing");
    });
});

test("reading the snapshot keeps the objects of entries that did not change", async () => {
    await withTwoProcesses(async ({ shared, repoB, a, b }) => {
        // Callers compare these objects across awaits to detect state changes.
        const before = a.getCodebaseInfo(shared);
        b.setCodebaseIndexed(repoB, { indexedFiles: 1, totalChunks: 1, status: "completed" });
        b.saveCodebaseSnapshot();
        assert.equal(a.getCodebaseInfo(shared), before);
        assert.equal(a.getCodebaseStatus(repoB), "indexed");

        b.setCodebaseIndexed(shared, { indexedFiles: 10, totalChunks: 20, status: "completed" });
        b.saveCodebaseSnapshot();
        assert.notEqual(a.getCodebaseInfo(shared), before);
    });
});

test("stats that lost to another process's re-index are not saved later", async () => {
    await withTwoProcesses(async ({ shared, repoA, a, b, readDiskEntry }) => {
        const beforeSync = indexed(a.getCodebaseInfo(shared));
        // Another process re-indexes the codebase while this one syncs it.
        b.setCodebaseIndexed(shared, { indexedFiles: 10, totalChunks: 20, status: "completed" });
        b.saveCodebaseSnapshot();
        const reindexed = readDiskEntry(shared);

        assert.equal(a.updateIndexedStats(shared, beforeSync, { indexedFiles: 2, totalChunks: 5 }), false);
        a.setCodebaseIndexing(repoA, 0);
        a.saveCodebaseSnapshot();

        assert.deepEqual(readDiskEntry(shared), reindexed);
        assert.deepEqual(a.getCodebaseInfo(shared), reindexed);
    });
});

test("a stats refresh leaves an unsaved change of the entry to the next save", async () => {
    await withTwoProcesses(async ({ shared, a, readDiskEntry }) => {
        a.setCodebaseIndexed(shared, { indexedFiles: 3, totalChunks: 9, status: "completed" }, NEW_OPTIONS);
        const refreshed = a.updateIndexedStats(shared, indexed(a.getCodebaseInfo(shared)), {
            indexedFiles: 4,
            totalChunks: 11
        });
        assert.equal(refreshed, true);
        a.saveCodebaseSnapshot();

        const entry = indexed(readDiskEntry(shared));
        assert.equal(entry.totalChunks, 11);
        assert.equal(entry.requestSplitter, "ast");
    });
});

test("a starting process still saves its cleanup of interrupted and deleted codebases", async () => {
    await withTwoProcesses(async ({ shared, repoB, b, startProcess, readDiskEntry }) => {
        const deleted = path.join(path.dirname(shared), "deleted");
        b.setCodebaseIndexing(repoB, 30, NEW_OPTIONS);
        b.setCodebaseIndexed(deleted, { indexedFiles: 1, totalChunks: 1, status: "completed" });
        b.saveCodebaseSnapshot();
        const sharedEntry = readDiskEntry(shared);

        // The other process exits mid-index, then a new session starts.
        const restarted = startProcess();

        const interrupted = readDiskEntry(repoB);
        assert.ok(interrupted?.status === "indexfailed");
        assert.equal(interrupted.lastAttemptedPercentage, 30);
        assert.equal(interrupted.requestSplitter, "ast");
        assert.equal(readDiskEntry(deleted), undefined);
        assert.deepEqual(readDiskEntry(shared), sharedEntry);
        assert.equal(restarted.getCodebaseStatus(repoB), "indexfailed");
    });
});

test("an index this process runs stays its own until it ends", async () => {
    await withTwoProcesses(async ({ repoA, a, b, startProcess, readDiskEntry }) => {
        a.setCodebaseIndexing(repoA, 0, NEW_OPTIONS);
        a.saveCodebaseSnapshot();
        a.setCodebaseIndexing(repoA, 40);
        a.saveCodebaseSnapshot();

        // A new session takes the entry for an interrupted index.
        startProcess();
        assert.equal(readDiskEntry(repoA)?.status, "indexfailed");

        const info = a.getCodebaseInfo(repoA);
        assert.ok(info?.status === "indexing");
        assert.equal(info.indexingPercentage, 40);
        a.saveCodebaseSnapshot();
        assert.equal(readDiskEntry(repoA)?.status, "indexing");

        // Once the index ends, other processes' changes show again.
        a.setCodebaseIndexed(repoA, { indexedFiles: 2, totalChunks: 4, status: "completed" });
        a.saveCodebaseSnapshot();
        b.removeCodebaseCompletely(repoA);
        b.saveCodebaseSnapshot();
        assert.equal(a.getCodebaseStatus(repoA), "not_found");
    });
});

test("a save that cannot take the lock writes nothing, and a retry writes it later", async () => {
    await withTwoProcesses(async ({ shared, repoB, a, b, snapshotFile, readDiskEntry }) => {
        // Another process holds the lock for longer than a save waits for it.
        const lockPath = `${snapshotFile}.lock`;
        await mkdir(lockPath);
        const before = readFileSync(snapshotFile, "utf8");
        b.setCodebaseIndexed(repoB, { indexedFiles: 1, totalChunks: 1, status: "completed" });
        b.saveCodebaseSnapshot();
        assert.equal(readFileSync(snapshotFile, "utf8"), before);
        assert.equal(b.getCodebaseStatus(repoB), "indexed");

        // Once the lock is free, this process saves before the retry runs.
        await rmdir(lockPath);
        a.removeCodebaseCompletely(shared);
        a.saveCodebaseSnapshot();
        await delay(1500); // the first retry runs after 1 s

        // Both changes are on disk, and each process sees the other's.
        assert.equal(readDiskEntry(repoB)?.status, "indexed");
        assert.equal(readDiskEntry(shared), undefined);
        assert.equal(a.getCodebaseStatus(repoB), "indexed");
        assert.equal(b.getCodebaseStatus(shared), "not_found");
    });
});

test("flushDeferredSave writes a save that waits for its retry, and nothing else", async () => {
    await withTwoProcesses(async ({ repoB, b, snapshotFile, readDiskEntry }) => {
        const before = readFileSync(snapshotFile, "utf8");
        b.flushDeferredSave();
        assert.equal(readFileSync(snapshotFile, "utf8"), before);

        const lockPath = `${snapshotFile}.lock`;
        await mkdir(lockPath);
        b.setCodebaseIndexed(repoB, { indexedFiles: 1, totalChunks: 1, status: "completed" });
        b.saveCodebaseSnapshot();
        await rmdir(lockPath);

        // What the MCP server does when it exits.
        b.flushDeferredSave();
        assert.equal(readDiskEntry(repoB)?.status, "indexed");
    });
});

test("a starting process keeps an index that completes while it loads", async () => {
    await withTwoProcesses(async ({ repoA, a, startProcess, readDiskEntry }) => {
        a.setCodebaseIndexing(repoA, 25, NEW_OPTIONS);
        a.saveCodebaseSnapshot();

        // The index completes after a new session read the file and before it saves:
        // in between, the load checks that each codebase still exists.
        const existsSync = fs.existsSync;
        let completed = false;
        fs.existsSync = ((candidate: PathLike) => {
            if (candidate === repoA && !completed) {
                completed = true;
                a.setCodebaseIndexed(repoA, { indexedFiles: 2, totalChunks: 4, status: "completed" });
                a.saveCodebaseSnapshot();
            }
            return existsSync(candidate);
        }) as typeof fs.existsSync;
        syncBuiltinESMExports();
        let restarted: SnapshotManager | undefined;
        try {
            restarted = startProcess();
        } finally {
            fs.existsSync = existsSync;
            syncBuiltinESMExports();
        }

        assert.ok(completed);
        assert.equal(indexed(readDiskEntry(repoA)).totalChunks, 4);
        assert.equal(restarted?.getCodebaseStatus(repoA), "indexed");
    });
});

test("a starting process that saves late marks failed only the indexes no process went on with", async () => {
    await withTwoProcesses(async ({ repoA, repoB, a, b, startProcess, snapshotFile, readDiskEntry }) => {
        a.setCodebaseIndexing(repoA, 25);
        a.saveCodebaseSnapshot();
        // The other process exits mid-index.
        b.setCodebaseIndexing(repoB, 30);
        b.saveCodebaseSnapshot();

        // A new session starts while the lock is busy, so its save waits for a retry.
        const lockPath = `${snapshotFile}.lock`;
        await mkdir(lockPath);
        const restarted = startProcess();
        await rmdir(lockPath);
        assert.equal(readDiskEntry(repoB)?.status, "indexing");

        // This process's index goes on meanwhile, and the new session shows it.
        a.setCodebaseIndexing(repoA, 40);
        a.saveCodebaseSnapshot();
        const progress = restarted.getCodebaseInfo(repoA);
        assert.ok(progress?.status === "indexing");
        assert.equal(progress.indexingPercentage, 40);
        assert.equal(restarted.getCodebaseStatus(repoB), "indexfailed");

        restarted.flushDeferredSave();
        assert.equal(readDiskEntry(repoA)?.status, "indexing");
        assert.equal(readDiskEntry(repoB)?.status, "indexfailed");
    });
});

test("a save in a new home creates ~/.context instead of waiting for a lock it cannot take", async () => {
    await withTwoProcesses(async ({ repoA, snapshotFile, readDiskEntry }) => {
        await rm(path.dirname(snapshotFile), { recursive: true });

        const snapshot = new SnapshotManager();
        snapshot.setCodebaseIndexed(repoA, { indexedFiles: 1, totalChunks: 1, status: "completed" });
        snapshot.saveCodebaseSnapshot();
        assert.equal(readDiskEntry(repoA)?.status, "indexed");
    });
});

test("a snapshot that fails to load does not delete entries at the next save", async () => {
    await withTwoProcesses(async ({ shared, repoA, repoB, b, startProcess, snapshotFile, readDiskEntry }) => {
        b.setCodebaseIndexing(repoB, 30);
        b.saveCodebaseSnapshot();
        // A malformed entry after the interrupted index makes the load throw.
        const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8")) as CodebaseSnapshotV2;
        (snapshot.codebases as Record<string, CodebaseInfo | null>)[repoA] = null;
        writeFileSync(snapshotFile, JSON.stringify(snapshot));

        const restarted = startProcess();
        restarted.saveCodebaseSnapshot();

        assert.equal(readDiskEntry(repoB)?.status, "indexing");
        assert.equal(restarted.getCodebaseStatus(shared), "indexed");
    });
});
