import * as vscode from 'vscode';
import { CodeIndexer, SearchQuery, SemanticSearchResult } from '@code-indexer/core';

export class SearchCommand {
    private codeIndexer: CodeIndexer;

    constructor(codeIndexer: CodeIndexer) {
        this.codeIndexer = codeIndexer;
    }

    async execute(): Promise<void> {
        const searchTerm = await vscode.window.showInputBox({
            placeHolder: 'Enter search term...',
            prompt: 'Search for functions, classes, variables, or any code using semantic search'
        });

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

            // Determine the correct file path
            let fullPath = result.filePath;

            // If result.filePath is not an absolute path, try to resolve it
            if (!result.filePath.startsWith('/') && !result.filePath.includes(':')) {
                // Try to find the file in workspace folders
                for (const folder of workspaceFolders) {
                    const testPath = vscode.Uri.joinPath(folder.uri, result.filePath);
                    try {
                        await vscode.workspace.fs.stat(testPath);
                        fullPath = testPath.fsPath;
                        break;
                    } catch {
                        // File not found in this workspace folder, try next
                    }
                }
            }

            if (!fullPath) {
                vscode.window.showErrorMessage(`File not found: ${result.filePath}`);
                return;
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
     * Generate quick pick items for VS Code
     */
    private generateQuickPickItems(results: SemanticSearchResult[], searchTerm: string, workspaceRoot?: string) {
        return results.slice(0, 20).map(result => {
            // Calculate relative path from workspace root if provided
            let displayPath = result.filePath;
            if (workspaceRoot && result.filePath.startsWith(workspaceRoot)) {
                displayPath = result.filePath.substring(workspaceRoot.length);
                // Remove leading slash if present
                if (displayPath.startsWith('/') || displayPath.startsWith('\\')) {
                    displayPath = displayPath.substring(1);
                }
            }

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