import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SnapshotManager } from "./snapshot.js";

async function withTempHome(run: (homeDir: string) => Promise<void>): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-snap-inc-"));
    const homeDir = path.join(tempRoot, "home");
    await mkdir(homeDir, { recursive: true });

    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    try {
        await run(homeDir);
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

test("recordIncrementalSyncSuccess updates freshness and persists across reload", async () => {
    await withTempHome(async () => {
        const codebasePath = path.join(os.tmpdir(), "fake-repo-" + Date.now());
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 10,
            totalChunks: 40,
            status: "completed",
        });
        const afterFull = snapshotManager.getCodebaseInfo(codebasePath);
        assert.ok(afterFull && afterFull.status === "indexed");
        const fullUpdated = afterFull.lastUpdated;
        const fullIndexAt = afterFull.lastFullIndexAt;
        assert.ok(fullIndexAt);

        await new Promise((r) => setTimeout(r, 5));

        const ok = snapshotManager.recordIncrementalSyncSuccess(codebasePath, {
            added: 1,
            removed: 0,
            modified: 2,
        });
        assert.equal(ok, true);
        snapshotManager.saveCodebaseSnapshot();

        const afterSync = snapshotManager.getCodebaseInfo(codebasePath);
        assert.ok(afterSync && afterSync.status === "indexed");
        assert.equal(afterSync.indexedFiles, 11);
        assert.equal(afterSync.lastFullIndexAt, fullIndexAt);
        assert.ok(afterSync.lastIncrementalSyncAt);
        assert.ok(afterSync.lastUpdated >= fullUpdated);
        assert.deepEqual(afterSync.lastSyncStats, { added: 1, removed: 0, modified: 2 });

        const snapshotPath = path.join(process.env.HOME!, ".context", "mcp-codebase-snapshot.json");
        const disk = JSON.parse(await readFile(snapshotPath, "utf8"));
        const diskInfo = disk.codebases[codebasePath];
        assert.equal(diskInfo.lastIncrementalSyncAt, afterSync.lastIncrementalSyncAt);

        const reloaded = new SnapshotManager();
        reloaded.loadCodebaseSnapshot();
        const fromDisk = reloaded.getCodebaseInfo(codebasePath);
        assert.ok(fromDisk && fromDisk.status === "indexed");
        assert.equal(fromDisk.lastIncrementalSyncAt, afterSync.lastIncrementalSyncAt);
        assert.deepEqual(fromDisk.lastSyncStats, { added: 1, removed: 0, modified: 2 });
    });
});

test("recordIncrementalSyncSuccess records zero-change sync", async () => {
    await withTempHome(async () => {
        const codebasePath = path.join(os.tmpdir(), "fake-repo-zero-" + Date.now());
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 5,
            totalChunks: 20,
            status: "completed",
        });

        const ok = snapshotManager.recordIncrementalSyncSuccess(codebasePath, {
            added: 0,
            removed: 0,
            modified: 0,
        });
        assert.equal(ok, true);
        const info = snapshotManager.getCodebaseInfo(codebasePath);
        assert.ok(info && info.status === "indexed");
        assert.ok(info.lastIncrementalSyncAt);
        assert.deepEqual(info.lastSyncStats, { added: 0, removed: 0, modified: 0 });
        assert.equal(info.indexedFiles, 5);
    });
});