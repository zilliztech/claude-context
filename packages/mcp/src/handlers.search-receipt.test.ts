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

function extractReceipt(text: string): any {
    const marker = "Search receipt:";
    const markerIndex = text.indexOf(marker);
    assert.notEqual(markerIndex, -1);

    const receiptText = text.slice(markerIndex + marker.length).trim();
    assert.ok(receiptText.startsWith("```json"));
    assert.ok(receiptText.endsWith("```"));

    return JSON.parse(receiptText.replace(/^```json\s*/, "").replace(/\s*```$/, ""));
}

test("search_code can include a privacy-preserving result receipt", async () => {
    await withTempHome(async (tempRoot) => {
        const codebasePath = path.join(tempRoot, "repo");
        await mkdir(codebasePath, { recursive: true });

        const snapshotManager = new SnapshotManager();
        snapshotManager.setCodebaseIndexed(codebasePath, {
            indexedFiles: 2,
            totalChunks: 4,
            status: "completed",
        });
        snapshotManager.saveCodebaseSnapshot();

        const rawQuery = "where is the CUSTOMER_SECRET auth token?";
        const rawContent = "const CUSTOMER_SECRET = process.env.CUSTOMER_SECRET;";
        const rawPath = "src/private/session.ts";
        const context = {
            getEmbedding() {
                return { getProvider: () => "test" };
            },
            async semanticSearch() {
                return [{
                    content: rawContent,
                    relativePath: rawPath,
                    startLine: 10,
                    endLine: 12,
                    language: "typescript",
                    score: 0.91,
                }];
            },
        };

        const handlers = new ToolHandlers(context as any, snapshotManager);
        (handlers as any).syncIndexedCodebasesFromCloud = async () => undefined;

        const result = await handlers.handleSearchCode({
            path: codebasePath,
            query: rawQuery,
            includeReceipt: true,
        });

        assert.equal(result.isError, undefined);
        const text = result.content[0].text;
        const receipt = extractReceipt(text);

        assert.equal(receipt.event, "context.search.returned");
        assert.match(receipt.receipt_id, /^sha256:[a-f0-9]{64}$/);
        assert.match(receipt.query_hash, /^sha256:[a-f0-9]{64}$/);
        assert.match(receipt.codebase_path_hash, /^sha256:[a-f0-9]{64}$/);
        assert.match(receipt.index_snapshot_id, /^sha256:[a-f0-9]{64}$/);
        assert.equal(receipt.result_count, 1);
        assert.equal(receipt.results[0].rank, 1);
        assert.equal(receipt.results[0].source.range, "L10-L12");
        assert.equal(receipt.results[0].source.extension, ".ts");
        assert.equal(receipt.results[0].score_bucket, "high");
        assert.match(receipt.results[0].chunk.hash, /^sha256:[a-f0-9]{64}$/);
        assert.match(receipt.results[0].duplicate.dedupe_key, /^sha256:[a-f0-9]{64}$/);

        const receiptJson = JSON.stringify(receipt);
        assert.equal(receiptJson.includes(rawQuery), false);
        assert.equal(receiptJson.includes(rawContent), false);
        assert.equal(receiptJson.includes(rawPath), false);
        assert.equal(receiptJson.includes(codebasePath), false);
    });
});
