import * as vscode from 'vscode';
import { WebviewHelper } from './webviewHelper';
import { SearchCommand } from '../commands/searchCommand';
import { IndexCommand } from '../commands/indexCommand';

export class SemanticSearchViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'semanticSearchView';
    private searchCommand: SearchCommand;
    private indexCommand: IndexCommand;

    constructor(private readonly _extensionUri: vscode.Uri, searchCommand: SearchCommand, indexCommand: IndexCommand) {
        this.searchCommand = searchCommand;
        this.indexCommand = indexCommand;
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
                        try {
                            // Use search command
                            const searchResults = await this.searchCommand.executeForWebview(
                                message.text,
                                50
                            );

                            // Convert SemanticSearchResult[] to webview format
                            const results = this.convertSearchResultsToWebviewFormat(searchResults);

                            // Send results back to webview
                            webviewView.webview.postMessage({
                                command: 'showResults',
                                results: results,
                                query: message.text
                            });

                            vscode.window.showInformationMessage(`Found ${results.length} results for: "${message.text}"`);
                        } catch (error) {
                            console.error('Search failed:', error);
                            vscode.window.showErrorMessage(`Search failed: ${error}`);
                            // Send empty results to webview
                            webviewView.webview.postMessage({
                                command: 'showResults',
                                results: [],
                                query: message.text
                            });
                        }
                        return;

                    case 'index':
                        // Handle index command
                        try {
                            await this.indexCommand.execute();
                            // Notify webview that indexing is complete
                            webviewView.webview.postMessage({
                                command: 'indexComplete'
                            });
                        } catch (error) {
                            console.error('Indexing error:', error);
                            // Still notify webview to reset button state
                            webviewView.webview.postMessage({
                                command: 'indexComplete'
                            });
                        }
                        return;

                    case 'openFile':
                        // Handle file opening
                        try {
                            const uri = vscode.Uri.file(message.filePath);
                            const document = await vscode.workspace.openTextDocument(uri);
                            const editor = await vscode.window.showTextDocument(document);

                            // Select range from startLine to endLine if provided, otherwise just jump to line
                            if (message.startLine !== undefined && message.endLine !== undefined) {
                                const startLine = Math.max(0, message.startLine - 1); // Convert to 0-based
                                const endLine = Math.max(0, message.endLine - 1); // Convert to 0-based
                                const range = new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
                                editor.selection = new vscode.Selection(range.start, range.end);
                                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                            } else if (message.line !== undefined) {
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
     * Convert SemanticSearchResult[] from core to webview format
     */
    private convertSearchResultsToWebviewFormat(searchResults: any[]): any[] {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const baseWorkspacePath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '/tmp';

        return searchResults.map(result => {
            // Determine the correct file path
            let filePath = result.filePath;

            // If result.filePath is not an absolute path, concatenate with workspace path
            if (!result.filePath.startsWith('/') && !result.filePath.includes(':')) {
                filePath = `${baseWorkspacePath}/${result.filePath}`;
            }

            // Calculate relative display path from workspace root
            let displayPath = result.filePath;
            if (baseWorkspacePath && result.filePath.startsWith(baseWorkspacePath)) {
                displayPath = result.filePath.substring(baseWorkspacePath.length);
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
                file: displayPath,
                filePath: filePath,
                line: result.startLine,
                preview: truncatedContent,
                context: `1 match in ${displayPath}`,
                score: result.score,
                startLine: result.startLine,
                endLine: result.endLine
            };
        });
    }
} 