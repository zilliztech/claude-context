import * as vscode from 'vscode';
import { Context, SearchQuery, SemanticSearchResult } from '@zilliz/claude-context-core';
import * as path from 'path';

export class SearchCommand {
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

                // Check if index exists
                progress.report({ increment: 20, message: 'Checking index...' });
                const hasIndex = await this.context.hasIndex(codebasePath);

                if (!hasIndex) {
                    vscode.window.showErrorMessage('Index not found. Please index the codebase first.');
                    return;
                }

                // Optionally prompt for file extension filters
                const extensionInput = await vscode.window.showInputBox({
                    placeHolder: 'Optional: filter by file extensions (e.g. .ts,.py,.java) – leave empty for all',
                    prompt: 'Enter a comma-separated list of file extensions to include',
                    value: ''
                });

                const fileExtensions = (extensionInput || '')
                    .split(',')
                    .map(e => e.trim())
                    .filter(Boolean);

                // Validate extensions strictly and build filter expression
                let filterExpr: string | undefined = undefined;
                if (fileExtensions.length > 0) {
                    const invalid = fileExtensions.filter(e => !(e.startsWith('.') && e.length > 1 && !/\s/.test(e)));
                    if (invalid.length > 0) {
                        vscode.window.showErrorMessage(`Invalid extensions: ${invalid.join(', ')}. Use proper extensions like '.ts', '.py'.`);
                        return;
                    }
                    const quoted = fileExtensions.map(e => `'${e}'`).join(',');

                    filterExpr = `fileExtension in [${quoted}]`;
                }

                // Use semantic search
                const query: SearchQuery = {
                    term: searchTerm,
                    includeContent: true,
                    limit: 20
                };

                console.log('🔍 Using semantic search...');
                progress.report({ increment: 50, message: 'Executing semantic search...' });

                let results = await this.context.semanticSearch(
                    codebasePath,
                    query.term,
                    query.limit || 20,
                    0.3, // similarity threshold
                    filterExpr
                );
                // No client-side filtering; filter pushed down via filter expression

                progress.report({ increment: 100, message: 'Search complete!' });

                if (results.length === 0) {
                    vscode.window.showInformationMessage(`No results found for "${searchTerm}"`);
                    return;
                }

                // Generate quick pick items for VS Code
                const quickPickItems = this.generateQuickPickItems(results, searchTerm, codebasePath);

                const selected = await vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: `Found ${results.length} results for "${searchTerm}" using semantic search`,
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (selected) {
                    await this.openResult(selected.result);
                }
            });

        } catch (error) {
            console.error('Search failed:', error);
            vscode.window.showErrorMessage(`Search failed: ${error}. Please ensure the codebase is indexed.`);
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
    async executeForWebview(searchTerm: string, limit: number = 50, fileExtensions: string[] = []): Promise<SemanticSearchResult[]> {
        // Get workspace root for codebase path
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder found. Please open a folder first.');
        }
        const codebasePath = workspaceFolders[0].uri.fsPath;

        // Check if index exists
        const hasIndex = await this.context.hasIndex(codebasePath);
        if (!hasIndex) {
            throw new Error('Index not found. Please index the codebase first.');
        }

        console.log('🔍 Using semantic search for webview...');

        // Validate extensions strictly and build filter expression
        let filterExpr: string | undefined = undefined;
        if (fileExtensions && fileExtensions.length > 0) {
            const invalid = fileExtensions.filter(e => !(typeof e === 'string' && e.startsWith('.') && e.length > 1 && !/\s/.test(e)));
            if (invalid.length > 0) {
                throw new Error(`Invalid extensions: ${invalid.join(', ')}. Use proper extensions like '.ts', '.py'.`);
            }
            const quoted = fileExtensions.map(e => `'${e}'`).join(',');
            filterExpr = `fileExtension in [${quoted}]`;
        }

        let results = await this.context.semanticSearch(
            codebasePath,
            searchTerm,
            limit,
            0.3, // similarity threshold
            filterExpr
        );
        return results;
    }

    /**
     * Check if index exists for the given codebase path
     */
    async hasIndex(codebasePath: string): Promise<boolean> {
        try {
            return await this.context.hasIndex(codebasePath);
        } catch (error) {
            console.error('Error checking index existence:', error);
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
                description: `$(search) semantic search${rankText}`,
                detail: truncatedContent,
                result: result
            };
        });
    }
} 