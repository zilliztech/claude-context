#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "../../..");

function appendLine(filePath, line) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${line}\n`);
}

async function runWorker() {
  const { SyncManager } = await import(path.join(repoRoot, "packages/mcp/dist/sync.js"));
  const { SnapshotManager } = await import(path.join(repoRoot, "packages/mcp/dist/snapshot.js"));

  const workerId = process.env.WORKER_ID ?? "unknown";
  const logFile = process.env.E2E_LOG_FILE;
  const codebasePath = process.env.E2E_CODEBASE_PATH;
  if (!logFile || !codebasePath) {
    throw new Error("E2E_LOG_FILE and E2E_CODEBASE_PATH are required");
  }

  const context = {
    async reindexByChange(targetPath) {
      appendLine(logFile, `entered:${workerId}:${targetPath}`);
      await sleep(1500);
      appendLine(logFile, `finished:${workerId}:${targetPath}`);
      return { added: 0, removed: 0, modified: 0 };
    }
  };

  const snapshotManager = new SnapshotManager();
  const syncManager = new SyncManager(context, snapshotManager);
  await syncManager.handleSyncIndex();
  appendLine(logFile, `done:${workerId}`);
}

function spawnWorker(workerId, env) {
  return spawn(process.execPath, [__filename, "--worker"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      WORKER_ID: workerId
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function waitForProcess(child, label) {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ label, code, stdout, stderr });
    });
  });
}

function createSnapshot(contextDir, codebasePath) {
  fs.writeFileSync(path.join(contextDir, "mcp-codebase-snapshot.json"), JSON.stringify({
    formatVersion: "v2",
    codebases: {
      [codebasePath]: {
        status: "indexed",
        indexedFiles: 1,
        totalChunks: 1,
        indexStatus: "completed",
        lastUpdated: new Date().toISOString()
      }
    },
    lastUpdated: new Date().toISOString()
  }, null, 2));
}

function createTempFixture(prefix) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const contextDir = path.join(tempHome, ".context");
  const codebasePath = path.join(tempHome, "repo");
  const logFile = path.join(tempHome, "sync.log");

  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(codebasePath, { recursive: true });
  fs.writeFileSync(path.join(codebasePath, "index.ts"), "export const value = 1;\n");

  return { tempHome, contextDir, codebasePath, logFile };
}

async function runConcurrentMain(workerCount = 2) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "claude-context-sync-lock-"));
  const contextDir = path.join(tempHome, ".context");
  const codebasePath = path.join(tempHome, "repo");
  const logFile = path.join(tempHome, "sync.log");

  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(codebasePath, { recursive: true });
  fs.writeFileSync(path.join(codebasePath, "index.ts"), "export const value = 1;\n");

  createSnapshot(contextDir, codebasePath);

  const sharedEnv = {
    HOME: tempHome,
    E2E_LOG_FILE: logFile,
    E2E_CODEBASE_PATH: codebasePath,
    CLAUDE_CONTEXT_SYNC_LOCK_STALE_MS: "60000"
  };

  const workers = Array.from({ length: workerCount }, (_, index) => {
    const label = String.fromCharCode("A".charCodeAt(0) + index);
    return waitForProcess(spawnWorker(label, sharedEnv), label);
  });
  const results = await Promise.all(workers);

  for (const result of results) {
    if (result.code !== 0) {
      console.error(`Worker ${result.label} failed with exit code ${result.code}`);
      console.error(result.stdout);
      console.error(result.stderr);
      process.exit(1);
    }
  }

  const lines = fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
  const entered = lines.filter((line) => line.startsWith("entered:"));
  const done = lines.filter((line) => line.startsWith("done:"));

  console.log(`tempHome=${tempHome}`);
  console.log(lines.join("\n"));

  if (entered.length !== 1) {
    console.error(`Expected exactly one worker to enter reindexByChange, got ${entered.length}`);
    process.exit(1);
  }

  if (done.length !== workerCount) {
    console.error(`Expected all ${workerCount} workers to complete, got ${done.length}`);
    process.exit(1);
  }

  console.log("sync lock e2e passed");
}

async function runStaleLockMain() {
  const { tempHome, contextDir, codebasePath, logFile } = createTempFixture("claude-context-stale-sync-lock-");
  const lockDir = path.join(contextDir, "mcp-sync.lock");

  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid: 12345 }, null, 2));

  const oldTime = new Date(Date.now() - 60_000);
  fs.utimesSync(lockDir, oldTime, oldTime);

  createSnapshot(contextDir, codebasePath);

  const worker = spawnWorker("stale", {
    HOME: tempHome,
    E2E_LOG_FILE: logFile,
    E2E_CODEBASE_PATH: codebasePath,
    CLAUDE_CONTEXT_SYNC_LOCK_STALE_MS: "1000"
  });
  const [result] = await Promise.all([waitForProcess(worker, "stale")]);
  if (result.code !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(1);
  }

  const lines = fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
  const entered = lines.filter((line) => line.startsWith("entered:"));
  console.log(`tempHome=${tempHome}`);
  console.log(lines.join("\n"));

  if (entered.length !== 1) {
    console.error(`Expected stale lock cleanup to allow one sync, got ${entered.length}`);
    process.exit(1);
  }

  console.log("stale sync lock e2e passed");
}

async function runHeldLockMain() {
  const { tempHome, contextDir, codebasePath, logFile } = createTempFixture("claude-context-held-sync-lock-");
  const lockDir = path.join(contextDir, "mcp-sync.lock");
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({
    pid: 12345,
    token: "external-owner",
    acquiredAt: new Date().toISOString()
  }, null, 2));
  createSnapshot(contextDir, codebasePath);

  const worker = spawnWorker("held", {
    HOME: tempHome,
    E2E_LOG_FILE: logFile,
    E2E_CODEBASE_PATH: codebasePath,
    CLAUDE_CONTEXT_SYNC_LOCK_STALE_MS: "60000"
  });
  const [result] = await Promise.all([waitForProcess(worker, "held")]);
  if (result.code !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(1);
  }

  const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean) : [];
  const entered = lines.filter((line) => line.startsWith("entered:"));
  console.log(`tempHome=${tempHome}`);
  console.log(lines.join("\n"));

  if (entered.length !== 0) {
    console.error(`Expected held lock to prevent sync, got ${entered.length}`);
    process.exit(1);
  }
  if (!fs.existsSync(lockDir)) {
    console.error("Expected held lock to remain in place");
    process.exit(1);
  }

  console.log("held sync lock e2e passed");
}

async function runEmptySnapshotMain() {
  const { tempHome, contextDir, codebasePath, logFile } = createTempFixture("claude-context-empty-sync-lock-");
  fs.writeFileSync(path.join(contextDir, "mcp-codebase-snapshot.json"), JSON.stringify({
    formatVersion: "v2",
    codebases: {},
    lastUpdated: new Date().toISOString()
  }, null, 2));

  const worker = spawnWorker("empty", {
    HOME: tempHome,
    E2E_LOG_FILE: logFile,
    E2E_CODEBASE_PATH: codebasePath
  });
  const [result] = await Promise.all([waitForProcess(worker, "empty")]);
  if (result.code !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(1);
  }

  const lockDir = path.join(contextDir, "mcp-sync.lock");
  const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean) : [];
  console.log(`tempHome=${tempHome}`);
  console.log(lines.join("\n"));

  if (fs.existsSync(lockDir)) {
    console.error("Expected empty snapshot sync to avoid creating a lock");
    process.exit(1);
  }

  console.log("empty snapshot e2e passed");
}

if (process.argv.includes("--worker")) {
  runWorker().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--stale")) {
  runStaleLockMain().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--held")) {
  runHeldLockMain().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--empty")) {
  runEmptySnapshotMain().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--many")) {
  runConcurrentMain(5).catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  runConcurrentMain(2).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
