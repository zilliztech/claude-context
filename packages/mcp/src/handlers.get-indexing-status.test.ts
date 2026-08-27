import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ToolHandlers } from "./handlers.js";
import { SnapshotManager } from "./snapshot.js";

async function withTempHome(run: (tempRoot: string) => Promise<void>): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-status-"));
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

test("get_indexing_status syncs cloud state before reading the snapshot", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        assert.equal(snapshotManager.getCodebaseStatus(codebasePath), "not_found");

        const handlers = new ToolHandlers({} as any, snapshotManager);
        let syncCalls = 0;
        (handlers as any).syncIndexedCodebasesFromCloud = async () => {
            syncCalls += 1;
            snapshotManager.setCodebaseIndexed(codebasePath, {
                indexedFiles: 3,
                totalChunks: 5,
                status: "completed",
            });
        };

        const result = await handlers.handleGetIndexingStatus({ path: codebasePath });

        assert.equal(syncCalls, 1);
        assert.equal(result.isError, undefined);
        assert.match(result.content[0].text, /fully indexed and ready for search/);
        assert.match(result.content[0].text, /3 files, 5 chunks/);
        assert.equal(snapshotManager.getCodebaseStatus(codebasePath), "indexed");
    });
});

test("cloud recovery skips malformed metadata and uses a later valid row", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "recovered-repo");
        const vectorDb = {
            listCollections: async () => ["code_chunks_recovery"],
            getCollectionDescription: async () => "",
            query: async (...args: unknown[]) => {
                assert.equal(args[3], 10);
                return [
                    { metadata: "not-json" },
                    { metadata: JSON.stringify({ codebasePath }) },
                ];
            },
            getCollectionRowCount: async () => 4,
        };
        const context = {
            getVectorDatabase: () => vectorDb,
            getCollectionName: () => "code_chunks_recovery",
        };
        const snapshotManager = new SnapshotManager();
        const handlers = new ToolHandlers(context as any, snapshotManager);

        await (handlers as any).syncIndexedCodebasesFromCloud();

        assert.equal(snapshotManager.getCodebaseStatus(codebasePath), "indexed");
        const recovered = snapshotManager.getCodebaseInfo(codebasePath);
        assert.equal(recovered?.indexedFiles, 4);
        assert.equal(recovered?.totalChunks, 4);
        assert.equal(recovered?.status, "indexed");
    });
});

test("cloud recovery keeps the local snapshot when every metadata row is malformed", async () => {
    await withTempHome(async (tempRoot) => {
        const existingCodebase = path.join(tempRoot, "existing-repo");
        const vectorDb = {
            listCollections: async () => ["code_chunks_recovery"],
            getCollectionDescription: async () => "",
            query: async () => [{ metadata: "not-json" }, { metadata: "also-not-json" }],
            getCollectionRowCount: async () => 4,
        };
        const context = {
            getVectorDatabase: () => vectorDb,
            getCollectionName: () => "code_chunks_recovery",
        };
        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(existingCodebase, {
            indexedFiles: 2,
            totalChunks: 3,
            status: "completed",
        });
        const handlers = new ToolHandlers(context as any, snapshotManager);

        await (handlers as any).syncIndexedCodebasesFromCloud();

        assert.equal(snapshotManager.getCodebaseStatus(existingCodebase), "indexed");
        const existing = snapshotManager.getCodebaseInfo(existingCodebase);
        assert.equal(existing?.indexedFiles, 2);
        assert.equal(existing?.totalChunks, 3);
        assert.equal(existing?.status, "indexed");
    });
});
