import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { Context } from "@zilliz/claude-context-core";
import { SnapshotManager } from "./snapshot.js";
import { SyncManager } from "./sync.js";

async function withTempHome(run: (homeDir: string, repoPath: string) => Promise<void>): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-sync-snapshot-"));
    const homeDir = path.join(tempRoot, "home");
    const repoPath = path.join(tempRoot, "repo");
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    try {
        await mkdir(homeDir, { recursive: true });
        await mkdir(repoPath, { recursive: true });
        await run(homeDir, repoPath);
    } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        await rm(tempRoot, { recursive: true, force: true });
    }
}

function makeContext(rowCount: number): Context {
    return {
        getCollectionName: () => "collection",
        getVectorDatabase: () => ({ getCollectionRowCount: async () => rowCount }),
        reindexByChange: async () => ({ added: 2, removed: 1, modified: 1 }),
    } as unknown as Context;
}

test("background sync persists updated file and chunk counts", async () => {
    await withTempHome(async (homeDir, repoPath) => {
        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(repoPath, {
            indexedFiles: 4,
            totalChunks: 10,
            status: "completed",
        });

        await new SyncManager(makeContext(23), snapshotManager).handleSyncIndex();

        const info = snapshotManager.getCodebaseInfo(repoPath);
        assert.ok(info && info.status === "indexed");
        assert.equal(info?.indexedFiles, 5);
        assert.equal(info?.totalChunks, 23);
        assert.equal(info?.lastSyncStats?.added, 2);
        assert.ok(info?.lastIncrementalSyncAt);

        const disk = JSON.parse(await readFile(path.join(homeDir, ".context", "mcp-codebase-snapshot.json"), "utf8"));
        assert.equal(disk.codebases[repoPath].totalChunks, 23);
    });
});

test("background sync keeps the previous chunk count when the row count is unavailable", async () => {
    await withTempHome(async (_homeDir, repoPath) => {
        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(repoPath, {
            indexedFiles: 4,
            totalChunks: 10,
            status: "completed",
        });

        await new SyncManager(makeContext(-1), snapshotManager).handleSyncIndex();

        const info = snapshotManager.getCodebaseInfo(repoPath);
        assert.ok(info && info.status === "indexed");
        assert.equal(info?.indexedFiles, 5);
        assert.equal(info?.totalChunks, 10);
        assert.ok(info?.lastIncrementalSyncAt);
    });
});
