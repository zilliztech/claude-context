import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ToolHandlers } from "./handlers.js";
import { SnapshotManager } from "./snapshot.js";

/**
 * force: true on a codebase that is currently being indexed used to call
 * removeCodebaseCompletely() and carry on. That drops the snapshot entry but does
 * not stop the background task, which keeps embedding and writing chunks into the
 * collection the new run is rebuilding — the orphaned-writer bug fixed for
 * clear_index in issue #199. The force path must use the same AbortController
 * machinery: cancel, await wind-down, then proceed.
 */

async function withTempHome(run: (tempRoot: string) => Promise<void>): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-force-"));
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

test("force re-index cancels the in-flight background index and waits for it before proceeding", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const events: string[] = [];

        // Stand in for a running background index: resolves only once aborted.
        const controller = new AbortController();
        const promise = new Promise<void>((resolve) => {
            controller.signal.addEventListener("abort", () => {
                setTimeout(() => {
                    events.push("wind-down");
                    resolve();
                }, 10);
            });
        });

        const context: any = {
            // Called after the "already indexing" branch — records that the
            // handler moved on from it.
            hasIndex: async () => {
                events.push("proceeded");
                return false;
            },
            getVectorDatabase: () => ({ checkCollectionLimit: async () => false }),
        };

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexing(codebasePath, 40);
        snapshotManager.saveCodebaseSnapshot();

        const handlers = new ToolHandlers(context, snapshotManager);
        (handlers as any).syncIndexedCodebasesFromCloud = async () => { };
        (handlers as any).indexingTasks.set(codebasePath, { controller, promise });

        await handlers.handleIndexCodebase({ path: codebasePath, force: true });

        assert.equal(controller.signal.aborted, true, "the in-flight index must be aborted, not abandoned");
        assert.equal(events[0], "wind-down", "wind-down must complete before the re-index proceeds");
        assert.ok(events.includes("proceeded"), "the force re-index must proceed after the wind-down");
        assert.equal((handlers as any).indexingTasks.has(codebasePath), false, "the cancelled task must be dropped");
    });
});

test("without force, an in-flight index is reported and left alone", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const controller = new AbortController();
        const promise = Promise.resolve();

        const context: any = { hasIndex: async () => false };

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexing(codebasePath, 40);
        snapshotManager.saveCodebaseSnapshot();

        const handlers = new ToolHandlers(context, snapshotManager);
        (handlers as any).syncIndexedCodebasesFromCloud = async () => { };
        (handlers as any).indexingTasks.set(codebasePath, { controller, promise });

        const result = await handlers.handleIndexCodebase({ path: codebasePath });

        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /already being indexed/);
        assert.equal(controller.signal.aborted, false, "a non-force call must not cancel anything");
    });
});
