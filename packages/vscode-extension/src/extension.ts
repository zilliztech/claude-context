import * as vscode from 'vscode';
import { SemanticSearchViewProvider } from './webview/semanticSearchProvider';

import { SearchCommand } from './commands/searchCommand';
import { IndexCommand } from './commands/indexCommand';
import { ConfigManager } from './config/configManager';
import { CodeIndexer, OpenAIEmbedding, VoyageAIEmbedding, MilvusVectorDatabase } from '@code-indexer/core';

let semanticSearchProvider: SemanticSearchViewProvider;
let searchCommand: SearchCommand;
let indexCommand: IndexCommand;
let configManager: ConfigManager;
let codeIndexer: CodeIndexer;

export async function activate(context: vscode.ExtensionContext) {
    console.log('CodeIndexer extension is now active!');

    // Initialize config manager
    configManager = new ConfigManager(context);

    // Check if this is the first launch
    if (configManager.isFirstLaunch()) {
        // Show setup dialog
        await showFirstTimeSetup(configManager);
    }

    // Initialize shared codeIndexer instance with embedding configuration
    codeIndexer = createCodeIndexerWithConfig(configManager);

    // Initialize providers and commands
    searchCommand = new SearchCommand(codeIndexer);
    indexCommand = new IndexCommand(codeIndexer);
    semanticSearchProvider = new SemanticSearchViewProvider(context.extensionUri, searchCommand, indexCommand, configManager);

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
            if (event.affectsConfiguration('codeIndexer.embeddingProvider') ||
                event.affectsConfiguration('codeIndexer.milvus')) {
                console.log('CodeIndexer configuration changed, refreshing...');
                refreshCodeIndexerConfig();
            }
        }),

        // Register commands
        vscode.commands.registerCommand('codeIndexer.semanticSearch', () => searchCommand.execute()),
        vscode.commands.registerCommand('codeIndexer.indexCodebase', () => indexCommand.execute()),
        vscode.commands.registerCommand('codeIndexer.clearIndex', () => indexCommand.clearIndex()),
        vscode.commands.registerCommand('codeIndexer.openSettings', () => {
            vscode.commands.executeCommand('codeIndexer.focusSemanticSearchView');
        }),
        vscode.commands.registerCommand('codeIndexer.refreshConfig', () => {
            refreshCodeIndexerConfig();
        }),
        vscode.commands.registerCommand('codeIndexer.focusSemanticSearchView', () => {
            vscode.commands.executeCommand('workbench.view.extension.codeIndexerSidebar');
        })
    ];

    context.subscriptions.push(...disposables);

    // Show status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = `$(search) CodeIndexer`;
    statusBarItem.tooltip = 'Click to open semantic search';
    statusBarItem.command = 'codeIndexer.semanticSearch';
    statusBarItem.show();

    context.subscriptions.push(statusBarItem);
}

function createCodeIndexerWithConfig(configManager: ConfigManager): CodeIndexer {
    const embeddingConfig = configManager.getEmbeddingProviderConfig();
    const milvusConfig = configManager.getMilvusFullConfig();

    try {
        let embedding;
        let vectorDatabase;

        // Create embedding instance
        if (embeddingConfig) {
            embedding = ConfigManager.createEmbeddingInstance(embeddingConfig.provider, embeddingConfig.config);
            console.log(`Embedding initialized with ${embeddingConfig.provider} (model: ${embeddingConfig.config.model})`);
        } else {
            console.log('No embedding configuration found, using default OpenAI embedding');
        }

        // Create vector database instance
        if (milvusConfig) {
            vectorDatabase = new MilvusVectorDatabase(milvusConfig);
            console.log(`Vector database initialized with Milvus (address: ${milvusConfig.address})`);
        } else {
            console.log('No Milvus configuration found, using default configuration');
        }

        const codeIndexerConfig: any = {};
        if (embedding) codeIndexerConfig.embedding = embedding;
        if (vectorDatabase) codeIndexerConfig.vectorDatabase = vectorDatabase;

        return new CodeIndexer(codeIndexerConfig);
    } catch (error) {
        console.error('Failed to create CodeIndexer with user config:', error);
        vscode.window.showErrorMessage(`Failed to initialize CodeIndexer: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return new CodeIndexer();
    }
}

function refreshCodeIndexerConfig() {
    console.log('Refreshing CodeIndexer configuration...');

    // Recreate CodeIndexer with new config
    codeIndexer = createCodeIndexerWithConfig(configManager);

    // Update commands with new CodeIndexer instance
    searchCommand.updateCodeIndexer(codeIndexer);
    indexCommand.updateCodeIndexer(codeIndexer);

    // Update the semantic search provider with new commands
    semanticSearchProvider.updateCommands(searchCommand, indexCommand);

    console.log('CodeIndexer configuration refreshed successfully');
    vscode.window.showInformationMessage('Embedding configuration updated successfully!');
}

async function showFirstTimeSetup(configManager: ConfigManager) {
    const result = await vscode.window.showInformationMessage(
        'Welcome to CodeIndexer! First-time setup requires configuring an embedding provider.',
        'Configure Now',
        'Configure Later'
    );

    if (result === 'Configure Now') {
        vscode.commands.executeCommand('codeIndexer.openSettings');
    }
}

export function deactivate() {
    console.log('CodeIndexer extension is now deactivated');
} 