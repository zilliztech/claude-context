import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ToolHandlers } from "./handlers.js";
import { SnapshotManager } from "./snapshot.js";

async function withTempHome(run: (tempRoot: string) => Promise<void>): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-sync-cloud-"));
    const homeDir = path.join(tempRoot, "home");
    await mkdir(homeDir, { recursive: true });

    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    try {
        await run(tempRoot);
    } finally {
        if (originalHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = originalHome;
        }

        if (originalUserProfile === undefined) {
            delete process.env.USERPROFILE;
        } else {
            process.env.USERPROFILE = originalUserProfile;
        }

        await rm(tempRoot, { recursive: true, force: true });
    }
}

test("sync-from-cloud recovery skips codebases currently indexing", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        // The codebase is genuinely being indexed right now: status is 'indexing',
        // and partial chunks have already been flushed to Milvus in EMBEDDING_BATCH_SIZE batches.
        snapshotManager.setCodebaseIndexing(codebasePath, 42);
        snapshotManager.saveCodebaseSnapshot();

        const collectionName = "hybrid_code_chunks_01234567";
        const vectorDb = {
            listCollections: async () => [collectionName],
            getCollectionDescription: async () => `codebasePath:${codebasePath}`,
            getCollectionRowCount: async () => 200, // partial batch count, not the real total
        };
        const context = {
            getVectorDatabase: () => vectorDb,
            getCollectionName: () => collectionName,
        };

        const handlers = new ToolHandlers(context as any, snapshotManager);
        await (handlers as any).syncIndexedCodebasesFromCloud();

        // Recovery must NOT have force-marked the in-progress codebase as completed.
        assert.equal(snapshotManager.getCodebaseStatus(codebasePath), "indexing");
        assert.deepEqual(snapshotManager.getIndexingCodebases(), [codebasePath]);
        assert.deepEqual(snapshotManager.getIndexedCodebases(), []);
    });
});

test("sync-from-cloud recovery still adopts codebases not tracked locally", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        assert.equal(snapshotManager.getCodebaseStatus(codebasePath), "not_found");

        const collectionName = "hybrid_code_chunks_01234567";
        const vectorDb = {
            listCollections: async () => [collectionName],
            getCollectionDescription: async () => `codebasePath:${codebasePath}`,
            getCollectionRowCount: async () => 500,
        };
        const context = {
            getVectorDatabase: () => vectorDb,
            getCollectionName: () => collectionName,
        };

        const handlers = new ToolHandlers(context as any, snapshotManager);
        await (handlers as any).syncIndexedCodebasesFromCloud();

        assert.equal(snapshotManager.getCodebaseStatus(codebasePath), "indexed");
        assert.deepEqual(snapshotManager.getIndexedCodebases(), [codebasePath]);
    });
});
