import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { VectorSearchResultValidationError } from "@zilliz/claude-context-core";
import { ToolHandlers } from "./handlers.js";

async function withTempRepo(run: (repoPath: string) => Promise<void>): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-context-mcp-search-"));
    const repoPath = path.join(tempRoot, "repo");
    await mkdir(repoPath, { recursive: true });

    try {
        await run(repoPath);
    } finally {
        await rm(tempRoot, { recursive: true, force: true });
    }
}

test("search_code returns actionable malformed Milvus result diagnostics", async () => {
    await withTempRepo(async (repoPath) => {
        const snapshotManager = {
            findIndexedCodebasePath: () => repoPath,
            findIndexingCodebasePath: () => undefined,
        };

        const context = {
            semanticSearch: async () => {
                throw new VectorSearchResultValidationError("Malformed Milvus search result for collection 'code_chunks'. Possible embedding dimension mismatch or collection mismatch.");
            },
            getEmbedding: () => ({
                getProvider: () => "ollama",
            }),
        };
        const handlers = new ToolHandlers(context as any, snapshotManager as any);
        (handlers as any).syncIndexedCodebasesFromCloud = async () => undefined;

        const result = await handlers.handleSearchCode({ path: repoPath, query: "hello", limit: 5 });

        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /Malformed Milvus search result/);
        assert.match(result.content[0].text, /embedding dimension mismatch/);
        assert.match(result.content[0].text, /collection mismatch/);
        assert.doesNotMatch(result.content[0].text, /indexed first/);
    });
});

test("search_code preserves normal empty-result behavior", async () => {
    await withTempRepo(async (repoPath) => {
        const snapshotManager = {
            findIndexedCodebasePath: () => repoPath,
            findIndexingCodebasePath: () => undefined,
        };

        const context = {
            semanticSearch: async () => [],
            getCollectionName: () => "code_chunks",
            getVectorDatabase: () => ({
                hasCollection: async () => true,
            }),
            getEmbedding: () => ({
                getProvider: () => "ollama",
            }),
        };
        const handlers = new ToolHandlers(context as any, snapshotManager as any);
        (handlers as any).syncIndexedCodebasesFromCloud = async () => undefined;

        const result = await handlers.handleSearchCode({ path: repoPath, query: "no matches", limit: 5 });

        assert.equal(result.isError, undefined);
        assert.match(result.content[0].text, /No results found for query: "no matches"/);
        assert.doesNotMatch(result.content[0].text, /malformed/i);
        assert.doesNotMatch(result.content[0].text, /indexed first/);
    });
});
