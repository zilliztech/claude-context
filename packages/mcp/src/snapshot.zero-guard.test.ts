import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SnapshotManager } from "./snapshot.js";

// Regression test for the "indexing, 100%" pin (oot-decomp, 2026-08-13).
// setCodebaseIndexed() refuses to persist 0/0/completed (Issue #295 force-reindex
// loop guard) — but it used to `return` without clearing the indexing entry, so
// the codebase stayed "currently being indexed" forever, across restarts.

async function withTempHome(run: (tempRoot: string) => Promise<void>): Promise<void> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-zeroguard-"));
    const homeDir = path.join(tempRoot, "home");
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    try {
        await fs.mkdir(path.join(homeDir, ".context"), { recursive: true });
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
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}

test("0/0+completed clears the indexing pin and records a failure instead of freezing at 100%", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await fs.mkdir(codebasePath);

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexing(codebasePath, 100);
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 0,
            totalChunks: 0,
            status: "completed",
        });
        snapshotManager.saveCodebaseSnapshot();

        assert.ok(!snapshotManager.getIndexingCodebases().includes(codebasePath));
        assert.ok(!snapshotManager.getIndexedCodebases().includes(codebasePath));
        assert.equal(snapshotManager.getCodebaseStatus(codebasePath), "indexfailed");
    });
});

test("a real index is still recorded normally", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await fs.mkdir(codebasePath);

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexing(codebasePath, 50);
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 12,
            totalChunks: 340,
            status: "completed",
        });
        snapshotManager.saveCodebaseSnapshot();

        assert.ok(!snapshotManager.getIndexingCodebases().includes(codebasePath));
        assert.ok(snapshotManager.getIndexedCodebases().includes(codebasePath));
        assert.equal(snapshotManager.getCodebaseStatus(codebasePath), "indexed");
    });
});
