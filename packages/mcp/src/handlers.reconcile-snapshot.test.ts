import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { Context } from "@zilliz/claude-context-core";

import { ToolHandlers } from "./handlers.js";
import { SnapshotManager } from "./snapshot.js";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function withFixture(
    t: TestContext,
    run: (codebasePath: string, snapshot: SnapshotManager) => Promise<void>
): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mcp-reconcile-"));
    const stateDirectory = path.join(tempRoot, "state");
    const codebasePath = path.join(tempRoot, "repo");
    await mkdir(path.join(stateDirectory, ".context"), { recursive: true });
    await mkdir(codebasePath);
    await writeFile(path.join(codebasePath, "index.ts"), "export const value = 1;\n");

    const homeMock = t.mock.method(os, "homedir", () => stateDirectory);
    syncBuiltinESMExports();
    try {
        await run(codebasePath, new SnapshotManager());
    } finally {
        homeMock.mock.restore();
        syncBuiltinESMExports();
        await rm(tempRoot, { recursive: true, force: true });
    }
}

function createHarness(codebasePath: string, snapshot: SnapshotManager) {
    const collectionName = "hybrid_code_chunks_reconcile_test";
    let collectionExists = false;
    let rowCount = 0;
    const entered = deferred<void>();
    const completion = deferred<void>();
    const database = {
        listCollections: async () => collectionExists ? [collectionName] : [],
        getCollectionDescription: async () => `codebasePath:${codebasePath}`,
        getCollectionRowCount: async () => rowCount,
        checkCollectionLimit: async () => true
    };
    const context = {
        getCollectionName: () => collectionName,
        getVectorDatabase: () => database,
        hasIndex: async () => collectionExists,
        getEffectiveIgnorePatterns: async () => [],
        getEffectiveSupportedExtensions: () => [".ts"],
        getPreparedCollection: async () => { collectionExists = true; },
        setSynchronizer: () => {},
        getEmbedding: () => ({ getProvider: () => "test", getDimension: () => 1 }),
        indexCodebase: async (_path: string, progress: (value: object) => void) => {
            rowCount = 4;
            progress({ phase: "Indexing", percentage: 33, current: 4, total: 12 });
            entered.resolve();
            await completion.promise;
            rowCount = 24;
            return { indexedFiles: 12, totalChunks: 24, status: "completed" as const };
        },
        semanticSearch: async () => [{
            relativePath: "index.ts", startLine: 1, endLine: 1,
            content: "export const value = 1;", score: 0.9
        }]
    };
    const handlers = new ToolHandlers(context as unknown as Context, snapshot);
    return {
        handlers,
        database,
        prepareCollection(rows: number) { collectionExists = true; rowCount = rows; },
        finish(error?: Error) {
            if (error) completion.reject(error);
            else completion.resolve();
        },
        async start() {
            const response = await handlers.handleIndexCodebase({ path: codebasePath });
            assert.equal(response.isError, undefined, response.content[0].text);
            // Only read the registered promise to join the task during cleanup.
            // The public handler creates and removes the task itself.
            const task = (handlers as any).indexingTasks.get(codebasePath);
            assert.ok(task);
            await Promise.race([
                entered.promise,
                task.promise.then(() => { throw new Error("Indexing ended before reaching the test barrier"); })
            ]);
            return { settled: task.promise as Promise<void> };
        }
    };
}

test("status and search preserve an active indexing task until it completes", async t => {
    await withFixture(t, async (codebasePath, snapshot) => {
        const harness = createHarness(codebasePath, snapshot);
        const { settled } = await harness.start();
        try {
            const status = await harness.handlers.handleGetIndexingStatus({ path: codebasePath });
            assert.match(status.content[0].text, /currently being indexed/);
            assert.equal(snapshot.getCodebaseStatus(codebasePath), "indexing");
            assert.deepEqual(snapshot.getIndexedCodebases(), []);

            const search = await harness.handlers.handleSearchCode({ path: codebasePath, query: "value" });
            assert.equal(search.isError, undefined);
            assert.match(search.content[0].text, /Indexing in Progress/);
            assert.equal(snapshot.getCodebaseStatus(codebasePath), "indexing");
        } finally {
            harness.finish();
            await settled;
        }

        const completed = await harness.handlers.handleGetIndexingStatus({ path: codebasePath });
        assert.match(completed.content[0].text, /12 files, 24 chunks/);

        // Completed tasks must no longer block recovery if the snapshot is lost.
        snapshot.removeCodebaseCompletely(codebasePath);
        snapshot.saveCodebaseSnapshot();
        const recovered = await harness.handlers.handleGetIndexingStatus({ path: codebasePath });
        assert.match(recovered.content[0].text, /fully indexed/);
        assert.equal(snapshot.getCodebaseInfo(codebasePath)?.status, "indexed");
    });
});

test("recovery adopts an existing collection with no local snapshot", async t => {
    await withFixture(t, async (codebasePath, snapshot) => {
        const harness = createHarness(codebasePath, snapshot);
        harness.prepareCollection(24);
        const response = await harness.handlers.handleGetIndexingStatus({ path: codebasePath });
        assert.match(response.content[0].text, /fully indexed/);
        assert.deepEqual(snapshot.getIndexedCodebases(), [codebasePath]);
    });
});

test("stale indexing imported from another process does not block recovery", async t => {
    await withFixture(t, async (codebasePath, localSnapshot) => {
        const ownerSnapshot = new SnapshotManager();
        ownerSnapshot.setCodebaseIndexing(codebasePath, 25);
        ownerSnapshot.saveCodebaseSnapshot();
        localSnapshot.saveCodebaseSnapshot(); // Imports the other process's progress.

        ownerSnapshot.setCodebaseIndexed(codebasePath, {
            indexedFiles: 12, totalChunks: 24, status: "completed"
        });
        ownerSnapshot.saveCodebaseSnapshot();
        assert.equal(localSnapshot.getCodebaseStatus(codebasePath), "indexing");
        assert.deepEqual(localSnapshot.getIndexedCodebases(), [codebasePath]);
        localSnapshot.saveCodebaseSnapshot(); // Reproduces the existing stale writeback.
        assert.deepEqual(localSnapshot.getIndexedCodebases(), []);

        const harness = createHarness(codebasePath, localSnapshot);
        harness.prepareCollection(24);
        for (let attempt = 0; attempt < 2; attempt++) {
            const status = await harness.handlers.handleGetIndexingStatus({ path: codebasePath });
            assert.match(status.content[0].text, /fully indexed/);
            assert.equal(localSnapshot.getCodebaseStatus(codebasePath), "indexed");
        }
    });
});

for (const transition of ["running", "completed", "failed"] as const) {
    test(`recovery preserves a task that becomes ${transition} during the row-count query`, async t => {
        await withFixture(t, async (codebasePath, snapshot) => {
            const harness = createHarness(codebasePath, snapshot);
            harness.prepareCollection(0);
            const queried = deferred<void>();
            const rowCount = deferred<number>();
            const originalCount = harness.database.getCollectionRowCount;
            let firstQuery = true;
            harness.database.getCollectionRowCount = async () => {
                if (!firstQuery) return originalCount();
                firstQuery = false;
                queried.resolve();
                return rowCount.promise;
            };

            const pendingStatus = harness.handlers.handleGetIndexingStatus({ path: codebasePath });
            await queried.promise;
            const { settled } = await harness.start();
            try {
                if (transition !== "running") {
                    harness.finish(transition === "failed" ? new Error("Indexing failed during recovery") : undefined);
                    await settled;
                }
                rowCount.resolve(4);
                const response = await pendingStatus;
                if (transition === "running") {
                    assert.match(response.content[0].text, /currently being indexed/);
                } else if (transition === "completed") {
                    assert.match(response.content[0].text, /12 files, 24 chunks/);
                } else {
                    assert.equal(snapshot.getCodebaseStatus(codebasePath), "indexfailed");
                    assert.match(response.content[0].text, /Indexing failed during recovery/);
                }
            } finally {
                rowCount.resolve(4);
                harness.finish();
                await Promise.all([pendingStatus, settled]);
            }
        });
    });
}

for (const count of [0, -1, "error"] as const) {
    test(`recovery leaves an untracked collection alone when its row count is ${count}`, async t => {
        await withFixture(t, async (codebasePath, snapshot) => {
            const harness = createHarness(codebasePath, snapshot);
            harness.prepareCollection(0);
            harness.database.getCollectionRowCount = async () => {
                if (count === "error") throw new Error("Row count unavailable");
                return count;
            };
            await harness.handlers.handleGetIndexingStatus({ path: codebasePath });
            assert.equal(snapshot.getCodebaseStatus(codebasePath), "not_found");
            assert.deepEqual(snapshot.getIndexedCodebases(), []);
        });
    });
}
