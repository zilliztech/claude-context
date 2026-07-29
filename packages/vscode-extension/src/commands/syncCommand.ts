import * as vscode from 'vscode';
import { Context } from '@zilliz/claude-context-core';
import * as fs from 'fs';

/** Progress callback parameter type */
interface ProgressInfo {
    phase: string;
    current: number;
    total: number;
    percentage: number;
}

export class SyncCommand {
    private context: Context;
    private isSyncing: boolean = false;

    constructor(context: Context) {
        this.context = context;
    }

    /**
     * Update the Context instance (used when configuration changes)
     */
    updateContext(context: Context): void {
        this.context = context;
    }

    /**
     * Sync the current workspace folder - check for changes and update index
     */
    async execute(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
            return;
        }

        if (this.isSyncing) {
            vscode.window.showWarningMessage('Sync is already in progress. Please wait for it to complete.');
            return;
        }

        // Use the first workspace folder as target
        const targetFolder = workspaceFolders[0];
        const codebasePath = targetFolder.uri.fsPath;

        // Check if the workspace folder exists
        if (!fs.existsSync(codebasePath)) {
            vscode.window.showErrorMessage(`Workspace folder '${codebasePath}' does not exist.`);
            return;
        }

        console.log(`[SYNC] Starting sync for current workspace: ${codebasePath}`);

        this.isSyncing = true;

        try {
            let syncStats: { added: number; removed: number; modified: number } | undefined;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Syncing Workspace Index',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Checking for file changes...' });

                try {
                    syncStats = await this.context.reindexByChange(
                        codebasePath,
                        (progressInfo: ProgressInfo) => {
                            const increment = progressInfo.percentage;
                            progress.report({
                                increment: increment,
                                message: progressInfo.phase
                            });
                        }
                    );
                } catch (error: any) {
                    console.error(`[SYNC] Error syncing workspace '${codebasePath}':`, error);
                    throw error;
                }
            });

            if (syncStats) {
                const totalChanges = syncStats.added + syncStats.removed + syncStats.modified;

                if (totalChanges > 0) {
                    vscode.window.showInformationMessage(
                        `✅ Sync complete!\n\nAdded: ${syncStats.added}, Removed: ${syncStats.removed}, Modified: ${syncStats.modified} files.`
                    );
                    console.log(`[SYNC] Sync complete for '${codebasePath}'. Added: ${syncStats.added}, Removed: ${syncStats.removed}, Modified: ${syncStats.modified}`);
                } else {
                    vscode.window.showInformationMessage('✅ Sync complete! No changes detected.');
                    console.log(`[SYNC] No changes detected for '${codebasePath}'`);
                }
            }

        } catch (error: any) {
            console.error('[SYNC] Sync failed:', error);
            vscode.window.showErrorMessage(`❌ Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            this.isSyncing = false;
            console.log(`[SYNC] Sync process finished for workspace: ${codebasePath}`);
        }
    }

    /**
     * Auto-sync functionality - periodically check for changes
     */
    async startAutoSync(intervalMinutes: number = 5): Promise<vscode.Disposable> {
        console.log(`[AUTO-SYNC] Starting auto-sync with ${intervalMinutes} minute interval`);

        const intervalMs = intervalMinutes * 60 * 1000;

        const interval = setInterval(async () => {
            try {
                console.log('[AUTO-SYNC] Running periodic sync...');
                await this.executeSilent();
            } catch (error) {
                console.warn('[AUTO-SYNC] Silent sync failed:', error);
                // Don't show error to user for auto-sync failures
            }
        }, intervalMs);

        // Return a disposable to stop the auto-sync
        return new vscode.Disposable(() => {
            console.log('[AUTO-SYNC] Stopping auto-sync');
            clearInterval(interval);
        });
    }

    /**
     * Silent sync - runs without progress notifications, used for auto-sync
     */
    async executeSilent(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        if (this.isSyncing) {
            console.log('[AUTO-SYNC] Sync already in progress, skipping...');
            return;
        }

        const targetFolder = workspaceFolders[0];
        const codebasePath = targetFolder.uri.fsPath;

        if (!fs.existsSync(codebasePath)) {
            console.warn(`[AUTO-SYNC] Workspace folder '${codebasePath}' does not exist`);
            return;
        }

        console.log(`[AUTO-SYNC] Starting silent sync for: ${codebasePath}`);

        this.isSyncing = true;

        try {
            const syncStats = await this.context.reindexByChange(codebasePath);

            const totalChanges = syncStats.added + syncStats.removed + syncStats.modified;

            if (totalChanges > 0) {
                console.log(`[AUTO-SYNC] Silent sync complete for '${codebasePath}'. Added: ${syncStats.added}, Removed: ${syncStats.removed}, Modified: ${syncStats.modified}`);

                // Show a subtle notification for auto-sync changes
                vscode.window.showInformationMessage(
                    `🔄 Index auto-updated: ${totalChanges} file changes detected`,
                    { modal: false }
                );
            } else {
                console.log(`[AUTO-SYNC] No changes detected for '${codebasePath}'`);
            }

        } catch (error: any) {
            console.error('[AUTO-SYNC] Silent sync failed:', error);
            throw error;
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Check if sync is currently in progress
     */
    getIsSyncing(): boolean {
        return this.isSyncing;
    }
}
