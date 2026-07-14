import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ToolHandlers } from "./handlers.js";
import { SnapshotManager } from "./snapshot.js";

async function withTempHome(run: (tempRoot: string) => Promise<void>): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-search-receipt-"));
    const homeDir = path.join(tempRoot, "home");
    await mkdir(path.join(homeDir, ".context"), { recursive: true });

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

test("search_code includes a privacy-preserving retrieval receipt", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 2,
            totalChunks: 3,
            status: "completed",
        });
        snapshotManager.saveCodebaseSnapshot();

        const context = {
            getVectorDatabase() {
                return {
                    async listCollections() {
                        return [];
                    },
                };
            },
            getEmbedding() {
                return {
                    getProvider() {
                        return "OpenAI";
                    },
                };
            },
            async semanticSearch() {
                return [{
                    content: "function resetPassword() { return secretToken; }",
                    relativePath: "src/auth.ts",
                    startLine: 10,
                    endLine: 12,
                    language: "typescript",
                    score: 0.876,
                }];
            },
        };

        const handlers = new ToolHandlers(context as any, snapshotManager);
        const result = await handlers.handleSearchCode({
            path: codebasePath,
            query: "reset password token flow",
            limit: 5,
        });

        assert.equal(result.isError, undefined);
        const text = result.content[0].text;
        assert.match(text, /Search receipt \(privacy-preserving\):/);

        const match = text.match(/Search receipt \(privacy-preserving\):\n```json\n([\s\S]+?)\n```/);
        assert.ok(match, "expected fenced JSON receipt");
        const receipt = JSON.parse(match[1]);

        assert.equal(receipt.tool, "search_code");
        assert.match(receipt.receipt_id, /^sha256:[a-f0-9]{64}$/);
        assert.match(receipt.query_hash, /^sha256:[a-f0-9]{64}$/);
        assert.equal(receipt.result_count, 1);
        assert.equal(receipt.index_snapshot.indexed_files, 2);
        assert.equal(receipt.index_snapshot.total_chunks, 3);
        assert.equal(receipt.results[0].rank, 1);
        assert.match(receipt.results[0].chunk_hash, /^sha256:[a-f0-9]{64}$/);
        assert.match(receipt.results[0].location_hash, /^sha256:[a-f0-9]{64}$/);
        assert.equal(receipt.results[0].score_bucket, 0.88);

        const receiptJson = JSON.stringify(receipt);
        assert.doesNotMatch(receiptJson, /reset password token flow/);
        assert.doesNotMatch(receiptJson, /secretToken/);
        assert.doesNotMatch(receiptJson, /src\/auth\.ts/);
    });
});
