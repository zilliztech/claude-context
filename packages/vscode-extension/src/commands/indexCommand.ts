import * as vscode from 'vscode';
import { CodeIndexer } from '@code-indexer/core';

export class IndexCommand {
    private codeIndexer: CodeIndexer;

    constructor(codeIndexer: CodeIndexer) {
        this.codeIndexer = codeIndexer;
    }

    /**
     * Update the CodeIndexer instance (used when configuration changes)
     */
    updateCodeIndexer(codeIndexer: CodeIndexer): void {
        this.codeIndexer = codeIndexer;
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
            let indexStats: { indexedFiles: number; totalChunks: number } | undefined;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Indexing Codebase',
                cancellable: false
            }, async (progress) => {
                let lastPercentage = 0;

                // Clear existing index first
                await this.codeIndexer.clearIndex(
                    selectedFolder.uri.fsPath,
                    (progressInfo) => {
                        // Clear index progress is usually fast, just show the message
                        progress.report({ increment: 0, message: progressInfo.phase });
                    }
                );

                // Start indexing with progress callback
                indexStats = await this.codeIndexer.indexCodebase(
                    selectedFolder.uri.fsPath,
                    (progressInfo) => {
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
                vscode.window.showInformationMessage(
                    `✅ Indexing complete!\n\nIndexed ${indexStats.indexedFiles} files with ${indexStats.totalChunks} code chunks.\n\nYou can now use semantic search.`
                );
            }

        } catch (error) {
            console.error('Indexing failed:', error);
            vscode.window.showErrorMessage(`❌ Indexing failed: ${error}`);
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
                await this.codeIndexer.clearIndex(
                    workspaceFolders[0].uri.fsPath,
                    (progressInfo) => {
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