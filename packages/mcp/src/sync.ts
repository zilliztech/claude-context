import * as fs from "fs";
import { Context, FileSynchronizer } from "@suoshengzhang/claude-context-core";
import { SnapshotManager } from "./snapshot.js";
import { getGitRepoName, checkServerSnapshot } from "@suoshengzhang/claude-context-core";
import { CodebaseInfoIndexed } from "./config.js";

export class SyncManager {
    private context: Context;
    private snapshotManager: SnapshotManager;
    private isSyncing: boolean = false;

    constructor(context: Context, snapshotManager: SnapshotManager) {
        this.context = context;
        this.snapshotManager = snapshotManager;
    }

    private async compareAndDelete(codebasePath: string, serverSnapshot: any, gitRepoName: string): Promise<void> {
        const relativeFilePaths = await this.context.getVectorDatabase().listFilePaths(this.context.getCollectionName(codebasePath), 1024);
        const oldFileHashes = this.context.getSynchronizer(codebasePath)?.getFileHashes();
        // Convert array of file hash entries to Map
        const newFileHashes = new Map<string, string>();
        for (const item of serverSnapshot.fileHashes) {
            const [key, value] = item;
            newFileHashes.set(key, value);
        }
        console.log(`[SYNC-DEBUG] Converted new file hashes to Map with ${newFileHashes.size} entries`);

        if (!oldFileHashes || !newFileHashes) {
            console.log('[SYNC-DEBUG] Missing file hashes for comparison');
            return;
        }

        // Convert oldFileHashes Map to array of entries for iteration
        const oldEntries = Array.from(oldFileHashes.entries());

        let totalDeleted = 0;
        for (let i = 0; i < oldEntries.length; i++) {
            const [relativePath, oldHash] = oldEntries[i];
            if (!relativeFilePaths.has(relativePath)) {
                continue;
            }
            // Find matching file in new hashes
            const newHash = newFileHashes.get(relativePath);

            // If hashes match, delete chunks since file is unchanged
            if (newHash && newHash === oldHash) {
                await this.context.deleteFileChunks(`code_chunks_${gitRepoName}`, relativePath);
                totalDeleted++;
            }
        }
        console.log(`[SYNC-DEBUG] Total deleted chunks: ${totalDeleted}`);
    }

    public async handleSyncIndex(logId: string): Promise<void> {
        if (this.isSyncing) {
            console.log(`[SYNC-DEBUG][${logId}] Index sync already in progress. Skipping.`);
            return;
        }
        this.isSyncing = true;

        const syncStartTime = Date.now();
        console.log(`[SYNC-DEBUG][${logId}] handleSyncIndex() called at ${new Date().toISOString()}`);

        const indexedCodebases = this.snapshotManager.getIndexedCodebases();

        if (indexedCodebases.length === 0) {
            console.log(`[SYNC-DEBUG][${logId}] No codebases indexed. Skipping sync.`);
            return;
        }

        console.log(`[SYNC-DEBUG][${logId}] Found ${indexedCodebases.length} indexed codebases:`, indexedCodebases);
        console.log(`[SYNC-DEBUG][${logId}] Starting index sync for all ${indexedCodebases.length} codebases...`);

        try {
            let totalStats = { added: 0, removed: 0, modified: 0 };

            for (let i = 0; i < indexedCodebases.length; i++) {
                const codebasePath = indexedCodebases[i];
                const codebaseStartTime = Date.now();

                console.log(`[SYNC-DEBUG][${logId}] [${i + 1}/${indexedCodebases.length}] Starting sync for codebase: '${codebasePath}'`);

                // Check if codebase path still exists
                try {
                    const pathExists = fs.existsSync(codebasePath);
                    console.log(`[SYNC-DEBUG][${logId}] Codebase path exists: ${pathExists}`);

                    if (!pathExists) {
                        console.warn(`[SYNC-DEBUG][${logId}] Codebase path '${codebasePath}' no longer exists. Skipping sync.`);
                        continue;
                    }
                } catch (pathError: any) {
                    console.error(`[SYNC-DEBUG][${logId}] Error checking codebase path '${codebasePath}':`, pathError);
                    continue;
                }

                try {
                    console.log(`[SYNC-DEBUG][${logId}] Calling context.reindexByChange() for '${codebasePath}'`);
                    const stats = await this.context.reindexByChange(codebasePath);
                    const codebaseElapsed = Date.now() - codebaseStartTime;

                    console.log(`[SYNC-DEBUG][${logId}] Reindex stats for '${codebasePath}':`, stats);
                    console.log(`[SYNC-DEBUG][${logId}] Codebase sync completed in ${codebaseElapsed}ms`);

                    // Accumulate total stats
                    totalStats.added += stats.added;
                    totalStats.removed += stats.removed;
                    totalStats.modified += stats.modified;

                    if (stats.added > 0 || stats.removed > 0 || stats.modified > 0) {
                        console.log(`[SYNC-DEBUG][${logId}] Sync complete for '${codebasePath}'. Added: ${stats.added}, Removed: ${stats.removed}, Modified: ${stats.modified} (${codebaseElapsed}ms)`);
                    } else {
                        console.log(`[SYNC-DEBUG][${logId}] No changes detected for '${codebasePath}' (${codebaseElapsed}ms)`);
                    }

                    // Get git repository name for server snapshot
                    const gitInfo = await getGitRepoName(codebasePath);
                    const gitRepoName = gitInfo.repoName;
                    if (!gitRepoName) {
                        console.log(`[SYNC-DEBUG][${logId}] No git repository found for ${codebasePath}, skipping server snapshot comparison`);
                        continue;
                    }

                    // Fetch server snapshot
                    const serverSnapshot = await checkServerSnapshot(this.context.getCodeAgentEndpoint(), gitRepoName);
                    if (serverSnapshot.error) {
                        console.error(`[SYNC-DEBUG][${logId}] Error fetching server snapshot for ${gitRepoName}:`, serverSnapshot.error);
                        continue;
                    }

                    const serverSnapshotVersion = serverSnapshot.version;
                    let codebaseInfo = this.snapshotManager.getCodebaseInfo(codebasePath) as CodebaseInfoIndexed;
                    const curSnapshotVersion = codebaseInfo?.serverSnapshotVersion;
                    console.log(`[SYNC-DEBUG][${logId}] Current vs Server snapshot version for ${gitRepoName}: ${curSnapshotVersion} -> ${serverSnapshotVersion}`);

                    let curCodebaseIndexStatus = {
                        indexedFiles: codebaseInfo?.indexedFiles || 0,
                        totalChunks: codebaseInfo?.totalChunks || 0,
                        status: codebaseInfo?.indexStatus || 'completed',
                    };
                    this.snapshotManager.setCodebaseIndexed(codebasePath, curCodebaseIndexStatus, serverSnapshotVersion);
                    this.snapshotManager.saveCodebaseSnapshot();

                    if (curSnapshotVersion !== serverSnapshotVersion) {
                        console.log(`[SYNC-DEBUG][${logId}] Server snapshot version changed for ${gitRepoName}: ${curSnapshotVersion} -> ${serverSnapshotVersion}`);
                        await this.compareAndDelete(codebasePath, serverSnapshot.json, gitRepoName);
                    }
                } catch (error: any) {
                    const codebaseElapsed = Date.now() - codebaseStartTime;
                    console.error(`[SYNC-DEBUG][${logId}] Error syncing codebase '${codebasePath}' after ${codebaseElapsed}ms:`, error);
                    console.error(`[SYNC-DEBUG][${logId}] Error stack:`, error.stack);

                    if (error.message.includes('Failed to query Milvus')) {
                        // Collection maybe deleted manually, delete the snapshot file
                        await FileSynchronizer.deleteSnapshot(codebasePath);
                    }

                    // Log additional error details
                    if (error.code) {
                        console.error(`[SYNC-DEBUG][${logId}] Error code: ${error.code}`);
                    }
                    if (error.errno) {
                        console.error(`[SYNC-DEBUG][${logId}] Error errno: ${error.errno}`);
                    }

                    // Continue with next codebase even if one fails
                }
            }

            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG][${logId}] Index sync completed for all codebases in ${totalElapsed}ms. Total changes - Added: ${totalStats.added}, Removed: ${totalStats.removed}, Modified: ${totalStats.modified}`);
        } catch (error: any) {
            const totalElapsed = Date.now() - syncStartTime;
            console.error(`[SYNC-DEBUG][${logId}] Error during index sync after ${totalElapsed}ms:`, error);
            console.error(`[SYNC-DEBUG][${logId}] Error stack:`, error.stack);
        } finally {
            this.isSyncing = false;
            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG][${logId}] handleSyncIndex() finished at ${new Date().toISOString()}, total duration: ${totalElapsed}ms`);
        }
    }

    public startBackgroundSync(): void {
        console.log('[SYNC-DEBUG] startBackgroundSync() called');

        // Execute initial sync immediately after a short delay to let server initialize
        console.log('[SYNC-DEBUG] Scheduling initial sync in 5 seconds...');
        setTimeout(async () => {
            const logId = String(Date.now());
            console.log(`[SYNC-DEBUG][${logId}] Executing initial sync after server startup`);
            try {
                await this.handleSyncIndex(logId);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                if (errorMessage.includes('Failed to query collection')) {
                    console.log(`[SYNC-DEBUG][${logId}] Collection not yet established, this is expected for new cluster users. Will retry on next sync cycle.`);
                } else {
                    console.error(`[SYNC-DEBUG][${logId}] Initial sync failed with unexpected error:`, error);
                    throw error;
                }
            }
        }, 5000); // Initial sync after 5 seconds

        // Periodically check for file changes and update the index
        console.log('[SYNC-DEBUG] Setting up periodic sync every 1 minutes (60000ms)');
        const syncInterval = setInterval(() => {
            const logId = String(Date.now());
            console.log(`[SYNC-DEBUG][${logId}] Executing scheduled periodic sync`);
            this.handleSyncIndex(logId);
        }, 1 * 60 * 1000); // every 1 minutes

        console.log('[SYNC-DEBUG] Background sync setup complete. Interval ID:', syncInterval);
    }
} 