import * as vscode from 'vscode';
import { WebviewHelper } from './webviewHelper';
import { SearchCommand } from '../commands/searchCommand';
import { IndexCommand } from '../commands/indexCommand';
import { ConfigManager, EmbeddingProviderConfig } from '../config/configManager';
import * as path from 'path';

export class SemanticSearchViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'semanticSearchView';
    private searchCommand: SearchCommand;
    private indexCommand: IndexCommand;
    private configManager: ConfigManager;

    constructor(private readonly _extensionUri: vscode.Uri, searchCommand: SearchCommand, indexCommand: IndexCommand, configManager: ConfigManager) {
        this.searchCommand = searchCommand;
        this.indexCommand = indexCommand;
        this.configManager = configManager;
    }

    /**
     * Update the command instances (used when configuration changes)
     */
    updateCommands(searchCommand: SearchCommand, indexCommand: IndexCommand): void {
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
            'src/webview/templates/semanticSearch.html',
            webviewView.webview
        );

        // Check index status on load
        this.checkIndexStatusAndUpdateWebview(webviewView.webview);

        // Send initial configuration data to webview
        this.sendCurrentConfig(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'checkIndex':
                        // Handle index status check
                        await this.checkIndexStatusAndUpdateWebview(webviewView.webview);
                        return;

                    case 'getConfig':
                        this.sendCurrentConfig(webviewView.webview);
                        return;

                    case 'saveConfig':
                        await this.saveConfig(message.config, webviewView.webview);
                        return;

                    case 'testEmbedding':
                        await this.testEmbedding(message.config, webviewView.webview);
                        return;

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
                            // Notify webview that indexing is complete and check index status
                            webviewView.webview.postMessage({
                                command: 'indexComplete'
                            });
                            // Update index status after completion
                            await this.checkIndexStatusAndUpdateWebview(webviewView.webview);
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
                            const workspaceFolders = vscode.workspace.workspaceFolders;
                            const workspaceRoot = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
                            const absPath = path.join(workspaceRoot, message.relativePath);
                            const uri = vscode.Uri.file(absPath);
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
                            vscode.window.showErrorMessage(`Failed to open file: ${message.relativePath}`);
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
            let filePath = result.relativePath;
            if (result.relativePath && !result.relativePath.startsWith('/') && !result.relativePath.includes(':')) {
                filePath = `${baseWorkspacePath}/${result.relativePath}`;
            }

            let displayPath = result.relativePath;

            // Truncate content for display
            const truncatedContent = result.content && result.content.length <= 150
                ? result.content
                : (result.content || '').substring(0, 150) + '...';

            return {
                file: displayPath,
                filePath: filePath,
                relativePath: result.relativePath,
                line: result.startLine,
                preview: truncatedContent,
                context: `1 match in ${displayPath}`,
                score: result.score,
                startLine: result.startLine,
                endLine: result.endLine
            };
        });
    }

    /**
     * Check index status and update webview accordingly
     */
    private async checkIndexStatusAndUpdateWebview(webview: vscode.Webview): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                webview.postMessage({
                    command: 'updateIndexStatus',
                    hasIndex: false
                });
                return;
            }

            const codebasePath = workspaceFolders[0].uri.fsPath;
            const hasIndex = await this.searchCommand.hasIndex(codebasePath);

            webview.postMessage({
                command: 'updateIndexStatus',
                hasIndex: hasIndex
            });
        } catch (error) {
            console.error('Failed to check index status:', error);
            webview.postMessage({
                command: 'updateIndexStatus',
                hasIndex: false
            });
        }
    }

    private sendCurrentConfig(webview: vscode.Webview) {
        const config = this.configManager.getEmbeddingProviderConfig();
        const milvusConfig = this.configManager.getMilvusConfig();
        const supportedProviders = ConfigManager.getSupportedProviders();

        webview.postMessage({
            command: 'configData',
            config: config,
            milvusConfig: milvusConfig,
            supportedProviders: supportedProviders
        });
    }

    private async saveConfig(configData: any, webview: vscode.Webview) {
        try {
            // Save embedding provider config
            const embeddingConfig: EmbeddingProviderConfig = {
                provider: configData.provider,
                config: configData.config
            };
            await this.configManager.saveEmbeddingProviderConfig(embeddingConfig);

            // Save Milvus config
            if (configData.milvusConfig) {
                await this.configManager.saveMilvusConfig(configData.milvusConfig);
            }

            this.configManager.markFirstLaunchComplete();

            // Add a small delay to ensure configuration is fully saved
            await new Promise(resolve => setTimeout(resolve, 100));

            // Notify extension to recreate CodeIndexer with new config
            vscode.commands.executeCommand('codeIndexer.reloadConfiguration');

            webview.postMessage({
                command: 'saveResult',
                success: true,
                message: 'Configuration saved successfully!'
            });

            vscode.window.showInformationMessage('CodeIndexer configuration saved successfully!');
        } catch (error) {
            webview.postMessage({
                command: 'saveResult',
                success: false,
                message: `Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }

    private async testEmbedding(embeddingConfig: any, webview: vscode.Webview) {
        try {
            // Test only embedding connection
            const embedding = ConfigManager.createEmbeddingInstance(embeddingConfig.provider, embeddingConfig.config);
            await embedding.embed('test embedding connection');

            webview.postMessage({
                command: 'testResult',
                success: true,
                message: 'Embedding connection test successful!'
            });
        } catch (error) {
            webview.postMessage({
                command: 'testResult',
                success: false,
                message: `Embedding connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }
} 