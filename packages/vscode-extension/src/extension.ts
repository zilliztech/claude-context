import * as vscode from 'vscode';
import { SemanticSearchViewProvider } from './webview/semanticSearchProvider';

import { SearchCommand } from './commands/searchCommand';
import { IndexCommand } from './commands/indexCommand';
import { SyncCommand } from './commands/syncCommand';
import { ConfigManager } from './config/configManager';
import { CodeContext, OpenAIEmbedding, VoyageAIEmbedding, GeminiEmbedding, MilvusRestfulVectorDatabase, AstCodeSplitter, LangChainCodeSplitter, SplitterType } from '@zilliz/code-context-core';

let semanticSearchProvider: SemanticSearchViewProvider;
let searchCommand: SearchCommand;
let indexCommand: IndexCommand;
let syncCommand: SyncCommand;
let configManager: ConfigManager;
let codeContext: CodeContext;
let autoSyncDisposable: vscode.Disposable | null = null;

export async function activate(context: vscode.ExtensionContext) {
    console.log('CodeContext extension is now active!');

    // Initialize config manager
    configManager = new ConfigManager(context);

    // Initialize shared codeContext instance with embedding configuration
    codeContext = createCodeContextWithConfig(configManager);

    // Initialize providers and commands
    searchCommand = new SearchCommand(codeContext);
    indexCommand = new IndexCommand(codeContext);
    syncCommand = new SyncCommand(codeContext);
    semanticSearchProvider = new SemanticSearchViewProvider(context.extensionUri, searchCommand, indexCommand, syncCommand, configManager);

    // Register command handlers
    const disposables = [
        // Register webview providers
        vscode.window.registerWebviewViewProvider(SemanticSearchViewProvider.viewType, semanticSearchProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }),

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('semanticCodeSearch.embeddingProvider') ||
                event.affectsConfiguration('semanticCodeSearch.milvus') ||
                event.affectsConfiguration('semanticCodeSearch.splitter') ||
                event.affectsConfiguration('semanticCodeSearch.autoSync')) {
                console.log('CodeContext configuration changed, reloading...');
                reloadCodeContextConfiguration();
            }
        }),

        // Register commands
        vscode.commands.registerCommand('semanticCodeSearch.semanticSearch', () => {
            // Get selected text from active editor
            const editor = vscode.window.activeTextEditor;
            const selectedText = editor?.document.getText(editor.selection);
            return searchCommand.execute(selectedText);
        }),
        vscode.commands.registerCommand('semanticCodeSearch.indexCodebase', () => indexCommand.execute()),
        vscode.commands.registerCommand('semanticCodeSearch.clearIndex', () => indexCommand.clearIndex()),
        vscode.commands.registerCommand('semanticCodeSearch.reloadConfiguration', () => reloadCodeContextConfiguration())
    ];

    context.subscriptions.push(...disposables);

    // Initialize auto-sync if enabled
    setupAutoSync();

    // Run initial sync on startup
    runInitialSync();

    // Show status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = `$(search) CodeContext`;
    statusBarItem.tooltip = 'Click to open semantic search';
    statusBarItem.command = 'semanticCodeSearch.semanticSearch';
    statusBarItem.show();

    context.subscriptions.push(statusBarItem);
}

async function runInitialSync() {
    try {
        console.log('[STARTUP] Running initial sync...');
        await syncCommand.executeSilent();
        console.log('[STARTUP] Initial sync completed');
    } catch (error) {
        console.error('[STARTUP] Initial sync failed:', error);
        // Don't show error message to user for startup sync failure
    }
}

function setupAutoSync() {
    const config = vscode.workspace.getConfiguration('semanticCodeSearch');
    const autoSyncEnabled = config.get<boolean>('autoSync.enabled', true);
    const autoSyncInterval = config.get<number>('autoSync.intervalMinutes', 5);

    // Stop existing auto-sync if running
    if (autoSyncDisposable) {
        autoSyncDisposable.dispose();
        autoSyncDisposable = null;
    }

    if (autoSyncEnabled) {
        console.log(`Setting up auto-sync with ${autoSyncInterval} minute interval`);

        // Start periodic auto-sync
        syncCommand.startAutoSync(autoSyncInterval).then(disposable => {
            autoSyncDisposable = disposable;
        }).catch(error => {
            console.error('Failed to start auto-sync:', error);
            vscode.window.showErrorMessage(`Failed to start auto-sync: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    } else {
        console.log('Auto-sync disabled');
    }
}

function createCodeContextWithConfig(configManager: ConfigManager): CodeContext {
    const embeddingConfig = configManager.getEmbeddingProviderConfig();
    const milvusConfig = configManager.getMilvusFullConfig();
    const splitterConfig = configManager.getSplitterConfig();

    try {
        let embedding;
        let vectorDatabase;

        const codeContextConfig: any = {};

        // Create embedding instance
        if (embeddingConfig) {
            embedding = ConfigManager.createEmbeddingInstance(embeddingConfig.provider, embeddingConfig.config);
            console.log(`Embedding initialized with ${embeddingConfig.provider} (model: ${embeddingConfig.config.model})`);
            codeContextConfig.embedding = embedding;
        } else {
            console.log('No embedding configuration found');
        }

        // Create vector database instance
        if (milvusConfig) {
            vectorDatabase = new MilvusRestfulVectorDatabase(milvusConfig);
            console.log(`Vector database initialized with Milvus REST API (address: ${milvusConfig.address})`);
            codeContextConfig.vectorDatabase = vectorDatabase;
        } else {
            vectorDatabase = new MilvusRestfulVectorDatabase({
                address: process.env.MILVUS_ADDRESS || 'http://localhost:19530',
                token: process.env.MILVUS_TOKEN || ''
            });
            console.log('No Milvus configuration found, using default REST API configuration');
            codeContextConfig.vectorDatabase = vectorDatabase;
        }

        // Create splitter instance
        let codeSplitter;
        if (splitterConfig) {
            if (splitterConfig.type === SplitterType.LANGCHAIN) {
                codeSplitter = new LangChainCodeSplitter(
                    splitterConfig.chunkSize ?? 1000,
                    splitterConfig.chunkOverlap ?? 200
                );
            } else { // Default to AST splitter
                codeSplitter = new AstCodeSplitter(
                    splitterConfig.chunkSize ?? 2500,
                    splitterConfig.chunkOverlap ?? 300
                );
            }
            codeContextConfig.codeSplitter = codeSplitter;
            console.log(`Splitter configured: ${splitterConfig.type} (chunkSize: ${splitterConfig.chunkSize}, overlap: ${splitterConfig.chunkOverlap})`);
        } else {
            codeSplitter = new AstCodeSplitter(2500, 300);
            codeContextConfig.codeSplitter = codeSplitter;
            console.log('No splitter configuration found, using default AST splitter (chunkSize: 2500, overlap: 300)');
        }
        return new CodeContext(codeContextConfig);
    } catch (error) {
        console.error('Failed to create CodeContext with user config:', error);
        vscode.window.showErrorMessage(`Failed to initialize CodeContext: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}

function reloadCodeContextConfiguration() {
    console.log('Reloading CodeContext configuration...');

    const embeddingConfig = configManager.getEmbeddingProviderConfig();
    const milvusConfig = configManager.getMilvusFullConfig();
    const splitterConfig = configManager.getSplitterConfig();

    try {
        // Update embedding if configuration exists
        if (embeddingConfig) {
            const embedding = ConfigManager.createEmbeddingInstance(embeddingConfig.provider, embeddingConfig.config);
            codeContext.updateEmbedding(embedding);
            console.log(`Embedding updated with ${embeddingConfig.provider} (model: ${embeddingConfig.config.model})`);
        }

        // Update vector database if configuration exists
        if (milvusConfig) {
            const vectorDatabase = new MilvusRestfulVectorDatabase(milvusConfig);
            codeContext.updateVectorDatabase(vectorDatabase);
            console.log(`Vector database updated with Milvus REST API (address: ${milvusConfig.address})`);
        }

        // Update splitter if configuration exists
        if (splitterConfig) {
            let newSplitter;
            if (splitterConfig.type === SplitterType.LANGCHAIN) {
                newSplitter = new LangChainCodeSplitter(
                    splitterConfig.chunkSize ?? 1000,
                    splitterConfig.chunkOverlap ?? 200
                );
            } else {
                newSplitter = new AstCodeSplitter(
                    splitterConfig.chunkSize ?? 2500,
                    splitterConfig.chunkOverlap ?? 300
                );
            }
            codeContext.updateSplitter(newSplitter);
            console.log(`Splitter updated: ${splitterConfig.type} (chunkSize: ${splitterConfig.chunkSize}, overlap: ${splitterConfig.chunkOverlap})`);
        } else {
            const defaultSplitter = new AstCodeSplitter(2500, 300);
            codeContext.updateSplitter(defaultSplitter);
            console.log('No splitter configuration found, using default AST splitter (chunkSize: 2500, overlap: 300)');
        }

        // Update command instances with new codeContext
        searchCommand.updateCodeContext(codeContext);
        indexCommand.updateCodeContext(codeContext);
        syncCommand.updateCodeContext(codeContext);

        // Restart auto-sync if it was enabled
        setupAutoSync();

        console.log('CodeContext configuration reloaded successfully');
        vscode.window.showInformationMessage('Configuration reloaded successfully!');
    } catch (error) {
        console.error('Failed to reload CodeContext configuration:', error);
        vscode.window.showErrorMessage(`Failed to reload configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export function deactivate() {
    console.log('CodeContext extension is now deactivated');

    // Stop auto-sync if running
    if (autoSyncDisposable) {
        autoSyncDisposable.dispose();
        autoSyncDisposable = null;
    }
}