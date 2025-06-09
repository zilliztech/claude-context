import * as vscode from 'vscode';
import { WebviewHelper } from './webviewHelper';
import { SearchService } from '@code-indexer/core';
import { SearchQuery } from '@code-indexer/core';

export class SemanticSearchViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'semanticSearchView';
    private searchService: SearchService;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this.searchService = new SearchService();
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        console.log('SemanticSearchViewProvider: resolveWebviewView called');

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = WebviewHelper.getHtmlContent(
            this._extensionUri,
            'src/webview/semanticSearch.html',
            webviewView.webview
        );

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'search':
                        // Use semantic search service
                        const searchQuery: SearchQuery = {
                            term: message.text,
                            limit: 50
                        };

                        const searchResults = await this.searchService.search(searchQuery);

                        // Convert SearchResult[] to webview format
                        const results = this.convertSearchResultsToWebviewFormat(searchResults);

                        // Send results back to webview
                        webviewView.webview.postMessage({
                            command: 'showResults',
                            results: results,
                            query: message.text
                        });

                        vscode.window.showInformationMessage(`Found ${results.length} results for: "${message.text}"`);
                        return;

                    case 'openFile':
                        // Handle file opening
                        try {
                            const uri = vscode.Uri.file(message.filePath);
                            const document = await vscode.workspace.openTextDocument(uri);
                            const editor = await vscode.window.showTextDocument(document);

                            // Jump to specific line if provided
                            if (message.line !== undefined) {
                                const line = Math.max(0, message.line - 1); // Convert to 0-based
                                const range = new vscode.Range(line, 0, line, 0);
                                editor.selection = new vscode.Selection(range.start, range.end);
                                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                            }
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to open file: ${message.filePath}`);
                        }
                        return;
                }
            },
            undefined,
            []
        );
    }

    /**
     * Convert SearchResult[] from core to webview format
     */
    private convertSearchResultsToWebviewFormat(searchResults: any[]): any[] {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const baseWorkspacePath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '/tmp';

        return searchResults.map(result => {
            // Determine the correct file path
            let filePath = result.file.path;

            // If result.file.path is not an absolute path, concatenate with workspace path
            if (!result.file.path.startsWith('/') && !result.file.path.includes(':')) {
                filePath = `${baseWorkspacePath}/${result.file.path}`;
            }

            if (result.symbol) {
                return {
                    file: result.file.path,
                    filePath: filePath,
                    line: result.symbol.location.line,
                    preview: result.symbol.signature,
                    context: `${result.symbol.type} in ${result.file.path}`
                };
            } else if (result.matches && result.matches.length > 0) {
                return {
                    file: result.file.path,
                    filePath: filePath,
                    line: result.matches[0].line,
                    preview: result.matches[0].context,
                    context: `${result.matches.length} matches in ${result.file.path}`
                };
            } else {
                return {
                    file: result.file.path,
                    filePath: filePath,
                    line: 1,
                    preview: result.file.path,
                    context: 'File match'
                };
            }
        });
    }
} 