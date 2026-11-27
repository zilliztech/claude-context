import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ToolHandlers } from "./handlers.js";
import { SnapshotManager } from "./snapshot.js";

/**
 * Tool responses are read by an LLM, which treats prescriptive language as an
 * instruction. "Use force=true to re-index" / "You can retry indexing" caused
 * measured force-reindex loops on active repos. These assert the responses
 * state the condition without prescribing the remedy.
 */

const PRESCRIPTIVE = /force\s*=\s*true|re-?index(ing)? (it|the codebase|by running)|Please (index|re-index|use the index_codebase|check if the codebase)|retry indexing/i;

async function withTempHome(run: (tempRoot: string) => Promise<void>): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-messaging-"));
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

function makeHandlers(context: any, snapshotManager: SnapshotManager): ToolHandlers {
    const handlers = new ToolHandlers(context, snapshotManager);
    (handlers as any).syncIndexedCodebasesFromCloud = async () => { };
    return handlers;
}

test("index_codebase on an already-indexed path is a success, not an error prescribing force", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 3,
            totalChunks: 5,
            status: "completed",
        });
        // getIndexedCodebases() reads the snapshot file, not the in-memory map
        snapshotManager.saveCodebaseSnapshot();

        const handlers = makeHandlers({ hasIndex: async () => true }, snapshotManager);
        const result = await handlers.handleIndexCodebase({ path: codebasePath });

        assert.equal(result.isError, false, "already-indexed is a success state, not an error");
        assert.doesNotMatch(result.content[0].text, PRESCRIPTIVE);
        assert.match(result.content[0].text, /already indexed/);
    });
});

test("search_code on an unindexed codebase states the condition without prescribing the fix", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        const handlers = makeHandlers({ hasIndex: async () => false }, snapshotManager);

        const result = await handlers.handleSearchCode({ path: codebasePath, query: "anything" });

        assert.equal(result.isError, true);
        assert.doesNotMatch(result.content[0].text, PRESCRIPTIVE);
        assert.match(result.content[0].text, /is not indexed/);
    });
});

test("get_indexing_status does not prescribe indexing when the codebase is unknown", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        const handlers = makeHandlers({}, snapshotManager);

        const result = await handlers.handleGetIndexingStatus({ path: codebasePath });

        assert.doesNotMatch(result.content[0].text, PRESCRIPTIVE);
        assert.match(result.content[0].text, /is not indexed/);
    });
});

test("get_indexing_status does not prescribe a retry after a failed index", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexFailed(codebasePath, "boom", 42);

        const handlers = makeHandlers({}, snapshotManager);
        const result = await handlers.handleGetIndexingStatus({ path: codebasePath });

        assert.doesNotMatch(result.content[0].text, PRESCRIPTIVE);
        assert.match(result.content[0].text, /indexing failed/i);
    });
});
