import * as vscode from 'vscode';
import { CodeContext, SearchQuery, SemanticSearchResult } from '@zilliz/code-context-core';
import * as path from 'path';

export class SearchCommand {
    private codeContext: CodeContext;

    constructor(codeContext: CodeContext) {
        this.codeContext = codeContext;
    }

    /**
     * Update the CodeContext instance (used when configuration changes)
     */
    updateCodeContext(codeContext: CodeContext): void {
        this.codeContext = codeContext;
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
                prompt: 'Search for functions, classes, variables, or any code using hybrid search (semantic + keyword)'
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
                progress.report({ increment: 0, message: 'Performing hybrid search...' });

                // Get workspace root for codebase path
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
                    return;
                }
                const codebasePath = workspaceFolders[0].uri.fsPath;

                // Check if hybrid index exists
                progress.report({ increment: 20, message: 'Checking hybrid index...' });
                const hasHybridIndex = await this.codeContext.hasHybridIndex(codebasePath);

                if (!hasHybridIndex) {
                    vscode.window.showErrorMessage('Hybrid index not found. Please index the codebase first using hybrid indexing.');
                    return;
                }

                // Use hybrid search
                const query: SearchQuery = {
                    term: searchTerm,
                    includeContent: true,
                    limit: 20
                };

                console.log('🔍 Using hybrid search (semantic + keyword)...');
                progress.report({ increment: 50, message: 'Executing hybrid search...' });

                const results = await this.codeContext.hybridSemanticSearch(
                    codebasePath,
                    query.term,
                    query.limit || 20,
                    0.3 // similarity threshold
                );

                progress.report({ increment: 100, message: 'Hybrid search complete!' });

                if (results.length === 0) {
                    vscode.window.showInformationMessage(`No results found for "${searchTerm}"`);
                    return;
                }

                // Generate quick pick items for VS Code
                const quickPickItems = this.generateQuickPickItems(results, searchTerm, codebasePath);

                const selected = await vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: `Found ${results.length} results for "${searchTerm}" using hybrid search`,
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (selected) {
                    await this.openResult(selected.result);
                }
            });

        } catch (error) {
            console.error('Hybrid search failed:', error);
            vscode.window.showErrorMessage(`Hybrid search failed: ${error}. Please ensure the codebase is indexed with hybrid indexing.`);
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

        // Check if hybrid index exists
        const hasHybridIndex = await this.codeContext.hasHybridIndex(codebasePath);
        if (!hasHybridIndex) {
            throw new Error('Hybrid index not found. Please index the codebase first using hybrid indexing.');
        }

        console.log('🔍 Using hybrid search for webview...');
        return await this.codeContext.hybridSemanticSearch(
            codebasePath,
            searchTerm,
            limit,
            0.3 // similarity threshold
        );
    }

    /**
     * Check if hybrid index exists for the given codebase path
     */
    async hasIndex(codebasePath: string): Promise<boolean> {
        try {
            return await this.codeContext.hasHybridIndex(codebasePath);
        } catch (error) {
            console.error('Error checking hybrid index existence:', error);
            return false;
        }
    }

    /**
     * Generate quick pick items for VS Code
     */
    private generateQuickPickItems(results: SemanticSearchResult[], searchTerm: string, workspaceRoot?: string) {
        return results.slice(0, 20).map((result, index) => {
            let displayPath = result.relativePath;
            // Truncate content for display
            const truncatedContent = result.content.length <= 150
                ? result.content
                : result.content.substring(0, 150) + '...';

            // Add rank info to description
            const rankText = ` (rank: ${index + 1})`;

            return {
                label: `$(file-code) ${displayPath}`,
                description: `$(combine) hybrid search${rankText}`,
                detail: truncatedContent,
                result: result
            };
        });
    }
} 