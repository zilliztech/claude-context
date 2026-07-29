import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SyncManager } from "./sync.js";
import { SnapshotManager } from "./snapshot.js";

async function withTempHome(run: (tempRoot: string) => Promise<void>): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-sync-meta-"));
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

test("handleSyncIndex persists incremental sync metadata after reindexByChange", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 4,
            totalChunks: 12,
            status: "completed",
        });
        snapshotManager.saveCodebaseSnapshot();

        const before = snapshotManager.getCodebaseInfo(codebasePath);
        assert.ok(before && before.status === "indexed");
        assert.equal(before.lastIncrementalSyncAt, undefined);

        const mockContext = {
            async reindexByChange() {
                return { added: 0, removed: 0, modified: 1 };
            },
        };

        const syncManager = new SyncManager(mockContext as any, snapshotManager);
        await syncManager.handleSyncIndex();

        const after = snapshotManager.getCodebaseInfo(codebasePath);
        assert.ok(after && after.status === "indexed");
        assert.ok(after.lastIncrementalSyncAt);
        assert.deepEqual(after.lastSyncStats, { added: 0, removed: 0, modified: 1 });
        assert.ok(after.lastUpdated >= before.lastUpdated);
    });
});