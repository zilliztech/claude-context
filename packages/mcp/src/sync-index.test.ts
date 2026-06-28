import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { Context } from "@zilliz/claude-context-core";

import { ToolHandlers } from "./handlers.js";
import { SnapshotManager } from "./snapshot.js";
import { SyncManager, type SyncIndexResult } from "./sync.js";

async function withTempHome(run: (tempRoot: string, homeDir: string) => Promise<void>): Promise<void> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-sync-index-"));
    const homeDir = path.join(tempRoot, "home");
    await fs.mkdir(homeDir, { recursive: true });

    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    try {
        await fs.mkdir(path.join(homeDir, ".context"), { recursive: true });
        await run(tempRoot, homeDir);
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
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}

function createMockContext(reindexByChange?: Context["reindexByChange"]): Context {
    return {
        reindexByChange:
            reindexByChange ??
            (async () => ({ added: 0, removed: 0, modified: 0 })),
    } as Context;
}

test("handleSyncIndex returns isError when path is not indexed", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await fs.mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        const syncManager = new SyncManager(createMockContext(), snapshotManager);
        const handlers = new ToolHandlers(createMockContext(), snapshotManager, syncManager);

        const result = await handlers.handleSyncIndex({ path: codebasePath });

        assert.equal(result.isError, true);
        const payload = JSON.parse(result.content[0].text) as SyncIndexResult;
        assert.equal(payload.status, "path_not_indexed");
    });
});

test("handleSyncIndex returns JSON with status completed and totals when syncManager returns completed", async () => {
    await withTempHome(async () => {
        const snapshotManager = new SnapshotManager();
        const completed: SyncIndexResult = {
            status: "completed",
            paths: [{ path: "/tmp/repo", added: 2, removed: 1, modified: 3 }],
            totals: { added: 2, removed: 1, modified: 3 },
        };

        const syncManager = {
            syncIndex: async () => completed,
        } as unknown as SyncManager;

        const handlers = new ToolHandlers(createMockContext(), snapshotManager, syncManager);
        const result = await handlers.handleSyncIndex({ wait: true });

        assert.equal(result.isError, undefined);
        const payload = JSON.parse(result.content[0].text) as SyncIndexResult;
        assert.equal(payload.status, "completed");
        assert.deepEqual(payload.totals, { added: 2, removed: 1, modified: 3 });
        assert.equal(payload.paths?.length, 1);
    });
});

test("syncIndex with wait=false returns skipped and does not block on reindexByChange", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await fs.mkdir(codebasePath, { recursive: true });

        let reindexCalls = 0;
        const context = createMockContext(async () => {
            reindexCalls += 1;
            return { added: 0, removed: 0, modified: 0 };
        });

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 1,
            totalChunks: 1,
            status: "completed",
        });
        snapshotManager.saveCodebaseSnapshot();

        const syncManager = new SyncManager(context, snapshotManager);
        const start = Date.now();
        const result = await syncManager.syncIndex({ path: codebasePath, wait: false });
        const elapsed = Date.now() - start;

        assert.equal(result.status, "skipped");
        assert.match(result.message ?? "", /background/i);
        assert.ok(elapsed < 500, `expected non-blocking return, took ${elapsed}ms`);

        await new Promise((r) => setTimeout(r, 50));
        assert.equal(reindexCalls, 1, "background sync should invoke reindexByChange without blocking the tool response");
    });
});

test("syncIndex returns skipped when isSyncing is already true", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await fs.mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 1,
            totalChunks: 1,
            status: "completed",
        });
        snapshotManager.saveCodebaseSnapshot();

        const syncManager = new SyncManager(createMockContext(), snapshotManager);
        (syncManager as unknown as { isSyncing: boolean }).isSyncing = true;

        const result = await syncManager.syncIndex({ wait: true });

        assert.equal(result.status, "skipped");
        assert.match(result.message ?? "", /already in progress/i);
    });
});

test("syncIndex returns skipped when global sync lock is held", async () => {
    await withTempHome(async (tempRoot, homeDir) => {
        const codebasePath = path.join(tempRoot, "repo");
        await fs.mkdir(codebasePath, { recursive: true });

        const lockPath = path.join(homeDir, ".context", "mcp-sync.lock");
        fsSync.mkdirSync(lockPath);
        fsSync.writeFileSync(
            path.join(lockPath, "owner.json"),
            JSON.stringify({ pid: 99999, token: "other-process", acquiredAt: new Date().toISOString() }, null, 2)
        );

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 1,
            totalChunks: 1,
            status: "completed",
        });
        snapshotManager.saveCodebaseSnapshot();

        const syncManager = new SyncManager(createMockContext(), snapshotManager);
        const result = await syncManager.syncIndex({ wait: true });

        assert.equal(result.status, "skipped");
        assert.match(result.message ?? "", /global sync lock|another MCP/i);
    });
});