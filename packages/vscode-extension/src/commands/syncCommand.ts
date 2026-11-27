import * as vscode from 'vscode';
import { Context } from '@zilliz/claude-context-core';
import * as fs from 'fs';
import { parseListInput } from '../utils/pathUtils';
import { STATE_INDEXED_PATHS, STATE_EXCLUDE_INPUT } from '../utils/stateKeys';

export class SyncCommand {
    private context: Context;
    private isSyncing: boolean = false;
    private extensionContext: vscode.ExtensionContext;

    constructor(context: Context, extensionContext: vscode.ExtensionContext) {
        this.context = context;
        this.extensionContext = extensionContext;
    }

    /**
     * Resolve the folders auto-sync/sync should operate on.
     * Uses the indexed-folder list when present; otherwise falls back to the
     * first workspace folder (the pre-subfolder behavior). Only existing folders
     * are returned. Also returns the saved exclude patterns to reapply.
     */
    private getSyncTargets(): { folders: string[]; excludes: string[] } {
        const excludes = parseListInput(
            this.extensionContext.workspaceState.get<string>(STATE_EXCLUDE_INPUT, '')
        );

        const indexedPaths = this.extensionContext.workspaceState.get<string[]>(STATE_INDEXED_PATHS, []);
        let folders = indexedPaths.filter(Boolean);
        if (folders.length === 0) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            folders = workspaceFolders && workspaceFolders.length > 0
                ? [workspaceFolders[0].uri.fsPath]
                : [];
        }

        folders = folders.filter(p => fs.existsSync(p));
        return { folders, excludes };
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

        const { folders, excludes } = this.getSyncTargets();
        if (folders.length === 0) {
            vscode.window.showErrorMessage('No indexed folder found to sync.');
            return;
        }

        console.log(`[SYNC] Starting sync for ${folders.length} folder(s): ${folders.join(', ')}`);

        this.isSyncing = true;

        try {
            let added = 0, removed = 0, modified = 0;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Syncing Workspace Index',
                cancellable: false
            }, async (progress) => {
                for (const codebasePath of folders) {
                    progress.report({ increment: 0, message: `Checking ${codebasePath}...` });
                    try {
                        const stats = await this.context.reindexByChange(
                            codebasePath,
                            (progressInfo) => {
                                progress.report({
                                    increment: progressInfo.percentage,
                                    message: progressInfo.phase
                                });
                            },
                            excludes
                        );
                        added += stats.added;
                        removed += stats.removed;
                        modified += stats.modified;
                    } catch (error: any) {
                        console.error(`[SYNC] Error syncing '${codebasePath}':`, error);
                        throw error;
                    }
                }
            });

            const totalChanges = added + removed + modified;
            if (totalChanges > 0) {
                vscode.window.showInformationMessage(
                    `✅ Sync complete!\n\nAdded: ${added}, Removed: ${removed}, Modified: ${modified} files.`
                );
                console.log(`[SYNC] Sync complete. Added: ${added}, Removed: ${removed}, Modified: ${modified}`);
            } else {
                vscode.window.showInformationMessage('✅ Sync complete! No changes detected.');
                console.log('[SYNC] No changes detected');
            }

        } catch (error: any) {
            console.error('[SYNC] Sync failed:', error);
            vscode.window.showErrorMessage(`❌ Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            this.isSyncing = false;
            console.log('[SYNC] Sync process finished');
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
        if (this.isSyncing) {
            console.log('[AUTO-SYNC] Sync already in progress, skipping...');
            return;
        }

        const { folders, excludes } = this.getSyncTargets();
        if (folders.length === 0) {
            return;
        }

        console.log(`[AUTO-SYNC] Starting silent sync for ${folders.length} folder(s)`);

        this.isSyncing = true;

        try {
            let added = 0, removed = 0, modified = 0;
            for (const codebasePath of folders) {
                // Skip folders that were never indexed (no collection yet) so we
                // don't attempt to insert into a non-existent collection.
                if (!(await this.context.hasIndex(codebasePath))) {
                    console.log(`[AUTO-SYNC] Skipping un-indexed folder: ${codebasePath}`);
                    continue;
                }
                const stats = await this.context.reindexByChange(codebasePath, undefined, excludes);
                added += stats.added;
                removed += stats.removed;
                modified += stats.modified;
            }

            const totalChanges = added + removed + modified;
            if (totalChanges > 0) {
                console.log(`[AUTO-SYNC] Silent sync complete. Added: ${added}, Removed: ${removed}, Modified: ${modified}`);
                vscode.window.showInformationMessage(
                    `🔄 Index auto-updated: ${totalChanges} file changes detected`,
                    { modal: false }
                );
            } else {
                console.log('[AUTO-SYNC] No changes detected');
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
