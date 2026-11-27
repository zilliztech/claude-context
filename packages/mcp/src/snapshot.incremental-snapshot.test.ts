import assert from "node:assert/strict";
import { mkdir, readFile, rm, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SnapshotManager } from "./snapshot.js";

test("recordIncrementalSyncSuccess updates and persists chunk statistics", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-snapshot-inc-"));
    const homeDir = path.join(tempRoot, "home");
    const codebasePath = path.join(tempRoot, "repo");
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    try {
        await mkdir(codebasePath, { recursive: true });
        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 4,
            totalChunks: 10,
            status: "completed",
        });

        assert.equal(snapshotManager.recordIncrementalSyncSuccess(codebasePath, {
            added: 2,
            removed: 1,
            modified: 1,
        }, 23), true);
        snapshotManager.saveCodebaseSnapshot();

        const info = snapshotManager.getCodebaseInfo(codebasePath);
        assert.ok(info && info.status === "indexed");
        assert.equal(info?.indexedFiles, 5);
        assert.equal(info?.totalChunks, 23);
        assert.deepEqual(info?.lastSyncStats, { added: 2, removed: 1, modified: 1 });

        const disk = JSON.parse(await readFile(path.join(homeDir, ".context", "mcp-codebase-snapshot.json"), "utf8"));
        assert.equal(disk.codebases[codebasePath].totalChunks, 23);
    } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        await rm(tempRoot, { recursive: true, force: true });
    }
});
