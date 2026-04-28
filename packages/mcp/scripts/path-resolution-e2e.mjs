#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "../../..");

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "claude-context-path-resolution-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const rootPath = path.join(tempHome, "repo");
const childPath = path.join(rootPath, "src");
const siblingPrefixPath = `${rootPath}-other`;

fs.mkdirSync(childPath, { recursive: true });
fs.mkdirSync(siblingPrefixPath, { recursive: true });

const { SnapshotManager } = await import(path.join(repoRoot, "packages/mcp/dist/snapshot.js"));
const { ToolHandlers } = await import(path.join(repoRoot, "packages/mcp/dist/handlers.js"));

const snapshotManager = new SnapshotManager();
snapshotManager.setCodebaseIndexed(rootPath, {
  indexedFiles: 2,
  totalChunks: 3,
  status: "completed"
});
snapshotManager.saveCodebaseSnapshot();

assert.equal(snapshotManager.findIndexedCodebasePath(childPath), rootPath);
assert.equal(snapshotManager.findIndexedCodebasePath(siblingPrefixPath), undefined);

const calls = [];
const context = {
  getVectorDatabase() {
    return {
      listCollections: async () => [],
      hasCollection: async () => true,
      getCollectionRowCount: async () => 3
    };
  },
  hasIndex: async (codebasePath) => {
    calls.push(["hasIndex", codebasePath]);
    return false;
  },
  getCollectionName: (codebasePath) => `collection_${path.basename(codebasePath)}`,
  getEmbedding: () => ({ getProvider: () => "FakeEmbedding" }),
  semanticSearch: async (codebasePath, query) => {
    calls.push(["semanticSearch", codebasePath, query]);
    return [{
      content: "needle",
      relativePath: "src/file.ts",
      startLine: 1,
      endLine: 1,
      language: "typescript",
      score: 0.9
    }];
  }
};

const handlers = new ToolHandlers(context, snapshotManager);
handlers.syncIndexedCodebasesFromCloud = async () => {};

const statusResult = await handlers.handleGetIndexingStatus({ path: childPath });
assert.equal(statusResult.isError, undefined);
assert.match(statusResult.content[0].text, /fully indexed and ready for search/);
assert.match(statusResult.content[0].text, new RegExp(rootPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

const searchResult = await handlers.handleSearchCode({ path: childPath, query: "needle" });
assert.equal(searchResult.isError, undefined);
assert.equal(calls.length, 1);
assert.deepEqual(calls[0], ["semanticSearch", rootPath, "needle"]);
assert.match(searchResult.content[0].text, /Found 1 results/);

console.log("path resolution e2e passed");
