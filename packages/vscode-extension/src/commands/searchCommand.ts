import * as vscode from 'vscode';
import { SearchService, SearchQuery, SearchResult } from '@code-indexer/core';

export class SearchCommand {
    private searchService: SearchService;

    constructor() {
        this.searchService = new SearchService();
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

                // Use the new semantic search service
                const query: SearchQuery = {
                    term: searchTerm,
                    includeContent: true,
                    limit: 20
                };

                const results = await this.searchService.search(query);

                progress.report({ increment: 100, message: 'Semantic search complete!' });

                if (results.length === 0) {
                    vscode.window.showInformationMessage(`No results found for "${searchTerm}"`);
                    return;
                }

                // Use the search service's quick pick items generation method
                const quickPickItems = this.searchService.generateQuickPickItems(results, searchTerm);

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

    private async openResult(result: SearchResult): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('No workspace folder found');
                return;
            }

            // Find the full path to the file
            let fullPath: string | undefined;
            for (const folder of workspaceFolders) {
                const testPath = vscode.Uri.joinPath(folder.uri, result.file.path);
                try {
                    await vscode.workspace.fs.stat(testPath);
                    fullPath = testPath.fsPath;
                    break;
                } catch {
                    // File not found in this workspace folder, try next
                }
            }

            if (!fullPath) {
                vscode.window.showErrorMessage(`File not found: ${result.file.path}`);
                return;
            }

            const document = await vscode.workspace.openTextDocument(fullPath);
            const editor = await vscode.window.showTextDocument(document);

            // Navigate to the location
            let line = 0;
            let column = 0;

            if (result.symbol) {
                line = result.symbol.location.line - 1; // VSCode uses 0-based line numbers
                column = result.symbol.location.column - 1;
            } else if (result.matches && result.matches.length > 0) {
                line = result.matches[0].line - 1;
                column = result.matches[0].column - 1;
            }

            const position = new vscode.Position(line, column);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

        } catch (error) {
            console.error('Failed to open result:', error);
            vscode.window.showErrorMessage(`Failed to open file: ${error}`);
        }
    }
} 