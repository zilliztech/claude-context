import * as vscode from 'vscode';
import { WebviewHelper } from './webviewHelper';
import { SearchCommand } from '../commands/searchCommand';
import { IndexCommand } from '../commands/indexCommand';
import { SyncCommand } from '../commands/syncCommand';
import { ConfigManager, EmbeddingProviderConfig } from '../config/configManager';
import * as path from 'path';
import { resolveIndexFolders, parseListInput } from '../utils/pathUtils';

const STATE_INDEXED_PATHS = 'semanticCodeSearch.indexedPaths';
const STATE_FOLDER_INPUT = 'semanticCodeSearch.folderInput';
const STATE_EXCLUDE_INPUT = 'semanticCodeSearch.excludeInput';

export class SemanticSearchViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'semanticSearchView';
    private searchCommand: SearchCommand;
    private indexCommand: IndexCommand;
    private syncCommand: SyncCommand;
    private configManager: ConfigManager;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        searchCommand: SearchCommand,
        indexCommand: IndexCommand,
        syncCommand: SyncCommand,
        configManager: ConfigManager,
        private readonly _extensionContext: vscode.ExtensionContext
    ) {
        this.searchCommand = searchCommand;
        this.indexCommand = indexCommand;
        this.syncCommand = syncCommand;
        this.configManager = configManager;
    }

    /**
     * Update the command instances (used when configuration changes)
     */
    updateCommands(searchCommand: SearchCommand, indexCommand: IndexCommand, syncCommand: SyncCommand): void {
        this.searchCommand = searchCommand;
        this.indexCommand = indexCommand;
        this.syncCommand = syncCommand;
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

        // Send saved folder/exclude inputs to prefill the panel
        this.sendIndexConfig(webviewView.webview);

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
                            // Use search command across all indexed folders
                            const indexedPaths = this._extensionContext.workspaceState.get<string[]>(STATE_INDEXED_PATHS, []);
                            const searchResults = await this.searchCommand.executeForWebview(
                                message.text,
                                50,
                                Array.isArray(message.fileExtensions) ? message.fileExtensions : [],
                                indexedPaths
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
                        try {
                            const workspaceFolders = vscode.workspace.workspaceFolders;
                            if (!workspaceFolders || workspaceFolders.length === 0) {
                                throw new Error('No workspace folder found. Please open a folder first.');
                            }
                            const workspaceRoot = workspaceFolders[0].uri.fsPath;

                            const folderInput: string = message.folderInput || '';
                            const excludeInput: string = message.excludeInput || '';

                            // Persist raw inputs for prefill.
                            await this._extensionContext.workspaceState.update(STATE_FOLDER_INPUT, folderInput);
                            await this._extensionContext.workspaceState.update(STATE_EXCLUDE_INPUT, excludeInput);

                            const { resolved, errors } = resolveIndexFolders(folderInput, workspaceRoot);
                            if (errors.length > 0) {
                                throw new Error(errors.join('\n'));
                            }
                            const excludes = parseListInput(excludeInput);

                            const { indexedPaths, indexedFiles, totalChunks } =
                                await this.indexCommand.executeForWebview(resolved, excludes);

                            // Persist the authoritative indexed-path list for search.
                            await this._extensionContext.workspaceState.update(STATE_INDEXED_PATHS, indexedPaths);

                            vscode.window.showInformationMessage(
                                `✅ Indexed ${indexedFiles} files (${totalChunks} chunks) across ${indexedPaths.length} folder(s).`
                            );
                        } catch (error) {
                            console.error('Indexing error:', error);
                            vscode.window.showErrorMessage(`❌ Indexing failed: ${error instanceof Error ? error.message : error}`);
                        } finally {
                            webviewView.webview.postMessage({ command: 'indexComplete' });
                            await this.checkIndexStatusAndUpdateWebview(webviewView.webview);
                        }
                        return;

                    case 'openFile':
                        // Handle file opening
                        try {
                            // Prefer the absolute path carried from the search result.
                            let absPath: string = message.absolutePath;
                            if (!absPath) {
                                const workspaceFolders = vscode.workspace.workspaceFolders;
                                const workspaceRoot = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
                                absPath = path.join(workspaceRoot, message.relativePath);
                            }
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
                            vscode.window.showErrorMessage(`Failed to open file: ${message.absolutePath || message.relativePath}`);
                        }
                        return;
                }
            },
            undefined,
            []
        );
    }

    /**
     * Convert TaggedResult[] from the search command to webview display format.
     */
    private convertSearchResultsToWebviewFormat(searchResults: any[]): any[] {
        return searchResults.map(result => {
            const folderName = result.searchFolder ? path.basename(result.searchFolder) : '';
            const displayPath = folderName ? `${folderName}/${result.relativePath}` : result.relativePath;

            const truncatedContent = result.content && result.content.length <= 150
                ? result.content
                : (result.content || '').substring(0, 150) + '...';

            return {
                file: displayPath,
                absolutePath: result.absolutePath,
                relativePath: result.relativePath,
                folder: folderName,
                line: result.startLine,
                preview: truncatedContent,
                context: folderName ? `match in ${folderName}` : `match in ${displayPath}`,
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
            const indexedPaths = this._extensionContext.workspaceState.get<string[]>(STATE_INDEXED_PATHS, []);
            const candidates = indexedPaths.length > 0
                ? indexedPaths
                : (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);

            let hasIndex = false;
            for (const p of candidates) {
                if (await this.searchCommand.hasIndex(p)) {
                    hasIndex = true;
                    break;
                }
            }

            webview.postMessage({ command: 'updateIndexStatus', hasIndex });
        } catch (error) {
            console.error('Failed to check index status:', error);
            webview.postMessage({ command: 'updateIndexStatus', hasIndex: false });
        }
    }

    private sendIndexConfig(webview: vscode.Webview) {
        const folderInput = this._extensionContext.workspaceState.get<string>(STATE_FOLDER_INPUT, '');
        const excludeInput = this._extensionContext.workspaceState.get<string>(STATE_EXCLUDE_INPUT, '');
        webview.postMessage({
            command: 'indexConfigData',
            folderInput,
            excludeInput
        });
    }

    private sendCurrentConfig(webview: vscode.Webview) {
        const config = this.configManager.getEmbeddingProviderConfig();
        const milvusConfig = this.configManager.getMilvusConfig();
        const splitterConfig = this.configManager.getSplitterConfig();
        const supportedProviders = ConfigManager.getSupportedProviders();

        webview.postMessage({
            command: 'configData',
            config: config,
            milvusConfig: milvusConfig,
            splitterConfig: splitterConfig,
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

            // Save splitter config
            if (configData.splitterConfig) {
                await this.configManager.saveSplitterConfig(configData.splitterConfig);
            }

            // Add a small delay to ensure configuration is fully saved
            await new Promise(resolve => setTimeout(resolve, 100));

            // Notify extension to recreate Context with new config
            vscode.commands.executeCommand('semanticCodeSearch.reloadConfiguration');

            webview.postMessage({
                command: 'saveResult',
                success: true,
                message: 'Configuration saved successfully!'
            });

            vscode.window.showInformationMessage('Context configuration saved successfully!');
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