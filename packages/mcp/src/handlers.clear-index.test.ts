import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ToolHandlers } from "./handlers.js";
import { SnapshotManager } from "./snapshot.js";

async function withTempHome(run: (tempRoot: string) => Promise<void>): Promise<void> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-clear-"));
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

function createContextMock() {
    return {
        clearIndex: test.mock.fn(async (_path: string) => undefined),
    };
}

test("clear_index clears a tracked index even when the local codebase directory no longer exists", async () => {
    await withTempHome(async (tempRoot) => {
        const deletedCodebasePath = path.join(tempRoot, "deleted-project");
        const context = createContextMock();
        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(deletedCodebasePath, {
            indexedFiles: 1,
            totalChunks: 2,
            status: "completed"
        });
        snapshotManager.saveCodebaseSnapshot();

        const handlers = new ToolHandlers(context as any, snapshotManager);

        const result = await handlers.handleClearIndex({ path: deletedCodebasePath });

        assert.equal(result.isError, undefined);
        assert.match(result.content[0].text, /Successfully cleared codebase/);
        assert.equal(context.clearIndex.mock.callCount(), 1);
        assert.equal(context.clearIndex.mock.calls[0].arguments[0], deletedCodebasePath);
        assert.equal(snapshotManager.getIndexedCodebases().includes(deletedCodebasePath), false);
    });
});

test("clear_index still rejects a missing local path when it is not tracked in the snapshot", async () => {
    await withTempHome(async (tempRoot) => {
        const missingUntrackedPath = path.join(tempRoot, "missing-untracked-project");
        const otherIndexedPath = path.join(tempRoot, "other-project");
        const context = createContextMock();
        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(otherIndexedPath, {
            indexedFiles: 1,
            totalChunks: 2,
            status: "completed"
        });
        snapshotManager.saveCodebaseSnapshot();

        const handlers = new ToolHandlers(context as any, snapshotManager);

        const result = await handlers.handleClearIndex({ path: missingUntrackedPath });

        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /not indexed or being indexed/);
        assert.equal(context.clearIndex.mock.callCount(), 0);
    });
});
