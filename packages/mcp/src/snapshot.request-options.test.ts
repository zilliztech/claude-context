import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SnapshotManager } from "./snapshot.js";

async function withTempHome(run: (tempRoot: string) => Promise<void>): Promise<void> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-snapshot-"));
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

test("preserves request-level index options across snapshot state transitions", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await fs.mkdir(codebasePath);

        const snapshotManager = new SnapshotManager();
        const indexOptions = {
            requestSplitter: "langchain" as const,
            requestCustomExtensions: ["foo", ".vue"],
            requestIgnorePatterns: ["drafts/**", "*.tmp"]
        };

        snapshotManager.setCodebaseIndexing(codebasePath, 0, indexOptions);
        snapshotManager.setCodebaseIndexing(codebasePath, 42);

        const indexingInfo = snapshotManager.getCodebaseInfo(codebasePath);
        assert.equal(indexingInfo?.status, "indexing");
        assert.equal(indexingInfo?.requestSplitter, "langchain");
        assert.deepEqual(indexingInfo?.requestCustomExtensions, ["foo", ".vue"]);
        assert.deepEqual(indexingInfo?.requestIgnorePatterns, ["drafts/**", "*.tmp"]);

        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 1,
            totalChunks: 2,
            status: "completed"
        });

        const indexedInfo = snapshotManager.getCodebaseInfo(codebasePath);
        assert.equal(indexedInfo?.status, "indexed");
        assert.equal(indexedInfo?.requestSplitter, "langchain");
        assert.deepEqual(indexedInfo?.requestCustomExtensions, ["foo", ".vue"]);
        assert.deepEqual(indexedInfo?.requestIgnorePatterns, ["drafts/**", "*.tmp"]);

        snapshotManager.setCodebaseIndexFailed(codebasePath, "boom", 55);

        const failedInfo = snapshotManager.getCodebaseInfo(codebasePath);
        assert.equal(failedInfo?.status, "indexfailed");
        assert.equal(failedInfo?.requestSplitter, "langchain");
        assert.deepEqual(failedInfo?.requestCustomExtensions, ["foo", ".vue"]);
        assert.deepEqual(failedInfo?.requestIgnorePatterns, ["drafts/**", "*.tmp"]);
    });
});

test("explicit empty request options clear previous request-level index options", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await fs.mkdir(codebasePath);

        const snapshotManager = new SnapshotManager();

        snapshotManager.setCodebaseIndexing(codebasePath, 0, {
            requestSplitter: "langchain",
            requestCustomExtensions: ["foo"],
            requestIgnorePatterns: ["drafts/**"]
        });
        snapshotManager.setCodebaseIndexing(codebasePath, 0, {});

        const info = snapshotManager.getCodebaseInfo(codebasePath);
        assert.equal(info?.status, "indexing");
        assert.equal(info?.requestSplitter, undefined);
        assert.equal(info?.requestCustomExtensions, undefined);
        assert.equal(info?.requestIgnorePatterns, undefined);
    });
});

test("preserves request-level index options when interrupted indexing is loaded as failed", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await fs.mkdir(codebasePath);

        const firstSnapshotManager = new SnapshotManager();
        firstSnapshotManager.setCodebaseIndexing(codebasePath, 25, {
            requestSplitter: "langchain",
            requestCustomExtensions: ["astro"],
            requestIgnorePatterns: ["drafts/**"]
        });
        firstSnapshotManager.saveCodebaseSnapshot();

        const secondSnapshotManager = new SnapshotManager();
        secondSnapshotManager.loadCodebaseSnapshot();

        const info = secondSnapshotManager.getCodebaseInfo(codebasePath);
        assert.equal(info?.status, "indexfailed");
        if (!info || info.status !== "indexfailed") {
            throw new Error("Expected interrupted indexing to load as indexfailed");
        }
        assert.equal(info.lastAttemptedPercentage, 25);
        assert.equal(info?.requestSplitter, "langchain");
        assert.deepEqual(info?.requestCustomExtensions, ["astro"]);
        assert.deepEqual(info?.requestIgnorePatterns, ["drafts/**"]);
    });
});
