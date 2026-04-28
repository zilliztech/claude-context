import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Context, FileSynchronizer, envManager } from "@zilliz/claude-context-core";
import { SnapshotManager } from "./snapshot.js";

const DEFAULT_INITIAL_SYNC_DELAY_MS = 5_000;
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MIN_SYNC_INTERVAL_MS = 1_000;
const DEFAULT_SYNC_LOCK_STALE_MS = 10 * 60 * 1000;
const SYNC_LOCK_STALE_ENV = "CLAUDE_CONTEXT_SYNC_LOCK_STALE_MS";

function isBackgroundSyncEnabled(): boolean {
    const value = envManager.get("CLAUDE_CONTEXT_BACKGROUND_SYNC");
    if (!value) {
        return false;
    }

    switch (value.trim().toLowerCase()) {
        case "1":
        case "true":
        case "yes":
        case "on":
            return true;
        case "0":
        case "false":
        case "no":
        case "off":
            return false;
        default:
            console.warn(
                `[SYNC-DEBUG] Invalid CLAUDE_CONTEXT_BACKGROUND_SYNC value '${value}'. ` +
                "Expected true/false. Background sync will remain disabled."
            );
            return false;
    }
}

function getBackgroundSyncIntervalMs(): number {
    const value = envManager.get("CLAUDE_CONTEXT_SYNC_INTERVAL_MS");
    if (!value) {
        return DEFAULT_SYNC_INTERVAL_MS;
    }

    const intervalMs = Number.parseInt(value, 10);
    if (!Number.isFinite(intervalMs) || intervalMs < MIN_SYNC_INTERVAL_MS) {
        console.warn(
            `[SYNC-DEBUG] Invalid CLAUDE_CONTEXT_SYNC_INTERVAL_MS value '${value}'. ` +
            `Falling back to ${DEFAULT_SYNC_INTERVAL_MS}ms.`
        );
        return DEFAULT_SYNC_INTERVAL_MS;
    }

    return intervalMs;
}

export class SyncManager {
    private context: Context;
    private snapshotManager: SnapshotManager;
    private isSyncing: boolean = false;
    private syncLockToken: string | null = null;

    constructor(context: Context, snapshotManager: SnapshotManager) {
        this.context = context;
        this.snapshotManager = snapshotManager;
    }

    private getSyncLockPath(): string {
        return path.join(os.homedir(), ".context", "mcp-sync.lock");
    }

    private getSyncLockStaleMs(): number {
        const value = process.env[SYNC_LOCK_STALE_ENV];
        if (!value) {
            return DEFAULT_SYNC_LOCK_STALE_MS;
        }

        const staleMs = Number.parseInt(value, 10);
        if (!Number.isFinite(staleMs) || staleMs <= 0) {
            console.warn(`[SYNC-DEBUG] Invalid ${SYNC_LOCK_STALE_ENV} value '${value}'. Falling back to ${DEFAULT_SYNC_LOCK_STALE_MS}ms.`);
            return DEFAULT_SYNC_LOCK_STALE_MS;
        }

        return staleMs;
    }

    private acquireGlobalSyncLock(): boolean {
        const lockPath = this.getSyncLockPath();
        const staleMs = this.getSyncLockStaleMs();
        const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });

        try {
            fs.mkdirSync(lockPath);
            fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
                pid: process.pid,
                token,
                acquiredAt: new Date().toISOString()
            }, null, 2));
            this.syncLockToken = token;
            console.log(`[SYNC-DEBUG] Acquired global sync lock: ${lockPath}`);
            return true;
        } catch (error: any) {
            if (error?.code !== "EEXIST") {
                console.warn(`[SYNC-DEBUG] Failed to acquire global sync lock: ${error?.message || String(error)}`);
                return false;
            }

            try {
                const stat = fs.statSync(lockPath);
                if (Date.now() - stat.mtimeMs > staleMs) {
                    const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
                    console.warn(`[SYNC-DEBUG] Reclaiming stale global sync lock: ${lockPath}`);
                    fs.renameSync(lockPath, stalePath);
                    fs.rmSync(stalePath, { recursive: true, force: true });
                    fs.mkdirSync(lockPath);
                    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
                        pid: process.pid,
                        token,
                        acquiredAt: new Date().toISOString(),
                        recoveredStaleLock: true
                    }, null, 2));
                    this.syncLockToken = token;
                    console.log(`[SYNC-DEBUG] Acquired global sync lock after stale cleanup: ${lockPath}`);
                    return true;
                }
            } catch (statError: any) {
                console.warn(`[SYNC-DEBUG] Could not inspect global sync lock: ${statError?.message || String(statError)}`);
            }

            console.log("[SYNC-DEBUG] Another MCP process is already syncing. Skipping this cycle.");
            return false;
        }
    }

    private releaseGlobalSyncLock(): void {
        const lockPath = this.getSyncLockPath();
        try {
            const ownerPath = path.join(lockPath, "owner.json");
            if (this.syncLockToken && fs.existsSync(ownerPath)) {
                const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
                if (owner.token && owner.token !== this.syncLockToken) {
                    console.warn(`[SYNC-DEBUG] Global sync lock is owned by another process. Skipping release: ${lockPath}`);
                    return;
                }
            }
            fs.rmSync(lockPath, { recursive: true, force: true });
            this.syncLockToken = null;
            console.log(`[SYNC-DEBUG] Released global sync lock: ${lockPath}`);
        } catch (error: any) {
            console.warn(`[SYNC-DEBUG] Failed to release global sync lock: ${error?.message || String(error)}`);
        }
    }

    public async handleSyncIndex(): Promise<void> {
        const syncStartTime = Date.now();
        console.log(`[SYNC-DEBUG] handleSyncIndex() called at ${new Date().toISOString()}`);

        const indexedCodebases = this.snapshotManager.getIndexedCodebases();

        if (indexedCodebases.length === 0) {
            console.log('[SYNC-DEBUG] No codebases indexed. Skipping sync.');
            return;
        }

        console.log(`[SYNC-DEBUG] Found ${indexedCodebases.length} indexed codebases:`, indexedCodebases);

        if (this.isSyncing) {
            console.log('[SYNC-DEBUG] Index sync already in progress. Skipping.');
            return;
        }

        if (!this.acquireGlobalSyncLock()) {
            return;
        }

        this.isSyncing = true;
        console.log(`[SYNC-DEBUG] Starting index sync for all ${indexedCodebases.length} codebases...`);

        try {
            let totalStats = { added: 0, removed: 0, modified: 0 };

            for (let i = 0; i < indexedCodebases.length; i++) {
                const codebasePath = indexedCodebases[i];
                const codebaseStartTime = Date.now();

                console.log(`[SYNC-DEBUG] [${i + 1}/${indexedCodebases.length}] Starting sync for codebase: '${codebasePath}'`);

                // Check if codebase path still exists
                try {
                    const pathExists = fs.existsSync(codebasePath);
                    console.log(`[SYNC-DEBUG] Codebase path exists: ${pathExists}`);

                    if (!pathExists) {
                        console.warn(`[SYNC-DEBUG] Codebase path '${codebasePath}' no longer exists. Skipping sync.`);
                        continue;
                    }
                } catch (pathError: any) {
                    console.error(`[SYNC-DEBUG] Error checking codebase path '${codebasePath}':`, pathError);
                    continue;
                }

                try {
                    console.log(`[SYNC-DEBUG] Calling context.reindexByChange() for '${codebasePath}'`);
                    const stats = await this.context.reindexByChange(codebasePath);
                    const codebaseElapsed = Date.now() - codebaseStartTime;

                    console.log(`[SYNC-DEBUG] Reindex stats for '${codebasePath}':`, stats);
                    console.log(`[SYNC-DEBUG] Codebase sync completed in ${codebaseElapsed}ms`);

                    // Accumulate total stats
                    totalStats.added += stats.added;
                    totalStats.removed += stats.removed;
                    totalStats.modified += stats.modified;

                    if (stats.added > 0 || stats.removed > 0 || stats.modified > 0) {
                        console.log(`[SYNC] Sync complete for '${codebasePath}'. Added: ${stats.added}, Removed: ${stats.removed}, Modified: ${stats.modified} (${codebaseElapsed}ms)`);
                    } else {
                        console.log(`[SYNC] No changes detected for '${codebasePath}' (${codebaseElapsed}ms)`);
                    }
                } catch (error: any) {
                    const codebaseElapsed = Date.now() - codebaseStartTime;
                    console.error(`[SYNC-DEBUG] Error syncing codebase '${codebasePath}' after ${codebaseElapsed}ms:`, error);
                    console.error(`[SYNC-DEBUG] Error stack:`, error.stack);

                    if (error.message.includes('Failed to query Milvus')) {
                        // Collection maybe deleted manually, delete the snapshot file
                        await FileSynchronizer.deleteSnapshot(codebasePath);
                    }

                    // Log additional error details
                    if (error.code) {
                        console.error(`[SYNC-DEBUG] Error code: ${error.code}`);
                    }
                    if (error.errno) {
                        console.error(`[SYNC-DEBUG] Error errno: ${error.errno}`);
                    }

                    // Continue with next codebase even if one fails
                }
            }

            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG] Total sync stats across all codebases: Added: ${totalStats.added}, Removed: ${totalStats.removed}, Modified: ${totalStats.modified}`);
            console.log(`[SYNC-DEBUG] Index sync completed for all codebases in ${totalElapsed}ms`);
            console.log(`[SYNC] Index sync completed for all codebases. Total changes - Added: ${totalStats.added}, Removed: ${totalStats.removed}, Modified: ${totalStats.modified}`);
        } catch (error: any) {
            const totalElapsed = Date.now() - syncStartTime;
            console.error(`[SYNC-DEBUG] Error during index sync after ${totalElapsed}ms:`, error);
            console.error(`[SYNC-DEBUG] Error stack:`, error.stack);
        } finally {
            this.isSyncing = false;
            this.releaseGlobalSyncLock();
            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG] handleSyncIndex() finished at ${new Date().toISOString()}, total duration: ${totalElapsed}ms`);
        }
    }

    public startBackgroundSync(): void {
        console.log('[SYNC-DEBUG] startBackgroundSync() called');

        if (!isBackgroundSyncEnabled()) {
            console.log('[SYNC-DEBUG] Background sync is disabled. Set CLAUDE_CONTEXT_BACKGROUND_SYNC=true to enable it.');
            return;
        }

        const syncIntervalMs = getBackgroundSyncIntervalMs();

        // Execute initial sync immediately after a short delay to let server initialize
        console.log(`[SYNC-DEBUG] Scheduling initial sync in ${DEFAULT_INITIAL_SYNC_DELAY_MS}ms...`);
        setTimeout(async () => {
            console.log('[SYNC-DEBUG] Executing initial sync after server startup');
            try {
                await this.handleSyncIndex();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                if (errorMessage.includes('Failed to query collection')) {
                    console.log('[SYNC-DEBUG] Collection not yet established, this is expected for new cluster users. Will retry on next sync cycle.');
                } else {
                    console.error('[SYNC-DEBUG] Initial sync failed with unexpected error:', error);
                    // Do not re-throw here: this callback runs via setTimeout with no caller to propagate to.
                }
            }
        }, DEFAULT_INITIAL_SYNC_DELAY_MS);

        // Periodically check for file changes and update the index
        console.log(`[SYNC-DEBUG] Setting up periodic sync every ${syncIntervalMs}ms`);
        const syncInterval = setInterval(() => {
            console.log('[SYNC-DEBUG] Executing scheduled periodic sync');
            this.handleSyncIndex();
        }, syncIntervalMs);

        console.log('[SYNC-DEBUG] Background sync setup complete. Interval ID:', syncInterval);
    }
}
