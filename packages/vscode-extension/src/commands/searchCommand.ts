import * as vscode from 'vscode';
import { CodeIndexer, SearchQuery, SemanticSearchResult } from '@zilliz/code-context-core';
import * as path from 'path';

export class SearchCommand {
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

    async execute(preSelectedText?: string): Promise<void> {
        let searchTerm: string | undefined;

        // Check if we have meaningful pre-selected text
        const trimmedPreSelectedText = preSelectedText?.trim();
        if (trimmedPreSelectedText && trimmedPreSelectedText.length > 0) {
            // Use the pre-selected text directly
            searchTerm = trimmedPreSelectedText;
        } else {
            // Show input box if no meaningful pre-selected text
            searchTerm = await vscode.window.showInputBox({
                placeHolder: 'Enter search term...',
                prompt: 'Search for functions, classes, variables, or any code using semantic search'
            });
        }

        if (!searchTerm) {
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Searching...',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Performing semantic search...' });

                // Get workspace root for codebase path
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
                    return;
                }
                const codebasePath = workspaceFolders[0].uri.fsPath;

                // Use the new semantic search service
                const query: SearchQuery = {
                    term: searchTerm,
                    includeContent: true,
                    limit: 20
                };

                const results = await this.codeIndexer.semanticSearch(
                    codebasePath,
                    query.term,
                    query.limit || 20,
                    0.3 // similarity threshold
                );

                progress.report({ increment: 100, message: 'Semantic search complete!' });

                if (results.length === 0) {
                    vscode.window.showInformationMessage(`No results found for "${searchTerm}"`);
                    return;
                }

                // Generate quick pick items for VS Code
                const quickPickItems = this.generateQuickPickItems(results, searchTerm, codebasePath);

                const selected = await vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: `Found ${results.length} results for "${searchTerm}"`,
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (selected) {
                    await this.openResult(selected.result);
                }
            });

        } catch (error) {
            console.error('Semantic search failed:', error);
            vscode.window.showErrorMessage(`Semantic search failed: ${error}`);
        }
    }

    private async openResult(result: SemanticSearchResult): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('No workspace folder found');
                return;
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            let fullPath = result.relativePath;
            if (!result.relativePath.startsWith('/') && !result.relativePath.includes(':')) {
                fullPath = path.join(workspaceRoot, result.relativePath);
            }

            const document = await vscode.workspace.openTextDocument(fullPath);
            const editor = await vscode.window.showTextDocument(document);

            // Navigate to the location
            const line = Math.max(0, result.startLine - 1); // Convert to 0-based line numbers
            const column = 0;

            const position = new vscode.Position(line, column);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

        } catch (error) {
            console.error('Failed to open result:', error);
            vscode.window.showErrorMessage(`Failed to open file: ${error}`);
        }
    }

    /**
     * Execute search for webview (without UI prompts)
     */
    async executeForWebview(searchTerm: string, limit: number = 50): Promise<SemanticSearchResult[]> {
        // Get workspace root for codebase path
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder found. Please open a folder first.');
        }
        const codebasePath = workspaceFolders[0].uri.fsPath;

        // Use the semantic search service
        return await this.codeIndexer.semanticSearch(
            codebasePath,
            searchTerm,
            limit,
            0.3 // similarity threshold
        );
    }

    /**
     * Check if index exists for the given codebase path
     */
    async hasIndex(codebasePath: string): Promise<boolean> {
        return await this.codeIndexer.hasIndex(codebasePath);
    }

    /**
     * Generate quick pick items for VS Code
     */
    private generateQuickPickItems(results: SemanticSearchResult[], searchTerm: string, workspaceRoot?: string) {
        return results.slice(0, 20).map(result => {
            let displayPath = result.relativePath;
            // Truncate content for display
            const truncatedContent = result.content.length <= 150
                ? result.content
                : result.content.substring(0, 150) + '...';

            return {
                label: `$(file-code) ${displayPath}`,
                description: `1 match in ${displayPath}`,
                detail: truncatedContent,
                result: result
            };
        });
    }
} 