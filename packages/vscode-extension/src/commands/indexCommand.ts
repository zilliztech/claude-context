import * as vscode from 'vscode';
import { Context } from '@zilliz/claude-context-core';
import * as path from 'path';

/** Progress callback parameter type */
interface ProgressInfo {
    phase: string;
    current: number;
    total: number;
    percentage: number;
}

export class IndexCommand {
    private context: Context;

    constructor(context: Context) {
        this.context = context;
    }

    /**
     * Update the Context instance (used when configuration changes)
     */
    updateContext(context: Context): void {
        this.context = context;
    }

    async execute(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
            return;
        }

        // Let user select the folder to index (default is the first workspace folder)
        let selectedFolder = workspaceFolders[0];

        if (workspaceFolders.length > 1) {
            const items = workspaceFolders.map(folder => ({
                label: folder.name,
                description: folder.uri.fsPath,
                folder: folder
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select folder to index'
            });

            if (!selected) {
                return;
            }
            selectedFolder = selected.folder;
        }

        const confirm = await vscode.window.showInformationMessage(
            `Index codebase at: ${selectedFolder.uri.fsPath}?\n\nThis will create embeddings for all supported code files.`,
            'Yes',
            'Cancel'
        );

        if (confirm !== 'Yes') {
            return;
        }

        try {
            let indexStats: { indexedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached' } | undefined;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Indexing Codebase',
                cancellable: false
            }, async (progress) => {
                let lastPercentage = 0;

                // Clear existing index first
                await this.context.clearIndex(
                    selectedFolder.uri.fsPath,
                    (progressInfo: ProgressInfo) => {
                        // Clear index progress is usually fast, just show the message
                        progress.report({ increment: 0, message: progressInfo.phase });
                    }
                );

                // Initialize file synchronizer
                progress.report({ increment: 0, message: 'Initializing file synchronizer...' });
                const { FileSynchronizer } = await import("@zilliz/claude-context-core");
                const synchronizer = new FileSynchronizer(selectedFolder.uri.fsPath, this.context.getIgnorePatterns() || []);
                await synchronizer.initialize();
                // Store synchronizer in the context's internal map using the collection name from context
                await this.context.getPreparedCollection(selectedFolder.uri.fsPath);
                const collectionName = this.context.getCollectionName(selectedFolder.uri.fsPath);
                this.context.setSynchronizer(collectionName, synchronizer);

                // Start indexing with progress callback
                indexStats = await this.context.indexCodebase(
                    selectedFolder.uri.fsPath,
                    (progressInfo: ProgressInfo) => {
                        // Calculate increment from last reported percentage
                        const increment = progressInfo.percentage - lastPercentage;
                        lastPercentage = progressInfo.percentage;

                        progress.report({
                            increment: increment,
                            message: progressInfo.phase
                        });
                    }
                );
            });

            if (indexStats) {
                const { indexedFiles, totalChunks, status } = indexStats;
                if (status === 'limit_reached') {
                    vscode.window.showWarningMessage(
                        `⚠️ Indexing paused. Reached chunk limit of 450,000.\n\nIndexed ${indexedFiles} files with ${totalChunks} code chunks.`
                    );
                } else {
                    vscode.window.showInformationMessage(
                        `✅ Indexing complete!\n\nIndexed ${indexedFiles} files with ${totalChunks} code chunks.\n\nYou can now use semantic search.`
                    );
                }
            }

        } catch (error: any) {
            console.error('Indexing failed:', error);
            const errorString = typeof error === 'string' ? error : (error.message || error.toString() || '');

            // Check for collection limit message from the core library
            if (errorString.includes('collection limit') || errorString.includes('zilliz.com/pricing')) {
                const message = 'Your Zilliz Cloud account has hit its collection limit. To continue creating collections, you\'ll need to expand your capacity. We recommend visiting https://zilliz.com/pricing to explore options for dedicated or serverless clusters.';
                const openButton = 'Explore Pricing Options';

                vscode.window.showErrorMessage(message, { modal: true }, openButton).then(selection => {
                    if (selection === openButton) {
                        vscode.env.openExternal(vscode.Uri.parse('https://zilliz.com/pricing'));
                    }
                });
            } else {
                vscode.window.showErrorMessage(`❌ Indexing failed: ${errorString}`);
            }
        }
    }

    async clearIndex(): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Clear all indexed data?',
            'Yes',
            'Cancel'
        );

        if (confirm !== 'Yes') {
            return;
        }

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Clearing Index',
                cancellable: false
            }, async (progress) => {
                await this.context.clearIndex(
                    workspaceFolders[0].uri.fsPath,
                    (progressInfo: ProgressInfo) => {
                        progress.report({
                            increment: progressInfo.percentage,
                            message: progressInfo.phase
                        });
                    }
                );
            });

            vscode.window.showInformationMessage('✅ Index cleared successfully');
        } catch (error) {
            console.error('Failed to clear index:', error);
            vscode.window.showErrorMessage(`❌ Failed to clear index: ${error}`);
        }
    }


} 