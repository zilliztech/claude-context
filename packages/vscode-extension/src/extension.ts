import * as vscode from 'vscode';
import { SemanticSearchViewProvider } from './webview/semanticSearchProvider';
import { SearchCommand } from './commands/searchCommand';
import { IndexCommand } from './commands/indexCommand';
import { CodeIndexer } from '@code-indexer/core';

let semanticSearchProvider: SemanticSearchViewProvider;
let searchCommand: SearchCommand;
let indexCommand: IndexCommand;

export async function activate(context: vscode.ExtensionContext) {
    console.log('CodeIndexer extension is now active!');

    // Initialize shared codeIndexer instance
    const codeIndexer = new CodeIndexer();

    // Initialize providers and commands
    searchCommand = new SearchCommand(codeIndexer);
    indexCommand = new IndexCommand(codeIndexer);
    semanticSearchProvider = new SemanticSearchViewProvider(context.extensionUri, searchCommand, indexCommand);

    // Register command handlers
    const disposables = [
        // Register webview providers
        vscode.window.registerWebviewViewProvider(SemanticSearchViewProvider.viewType, semanticSearchProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }),

        // Register commands
        vscode.commands.registerCommand('codeIndexer.semanticSearch', () => {
            vscode.window.showInformationMessage('Semantic Search command executed!');
        }),
        vscode.commands.registerCommand('codeIndexer.search', () => searchCommand.execute()),
        vscode.commands.registerCommand('codeIndexer.indexCodebase', () => indexCommand.execute()),
        vscode.commands.registerCommand('codeIndexer.clearIndex', () => indexCommand.clearIndex()),
        vscode.commands.registerCommand('codeIndexer.indexStats', () => indexCommand.getIndexStats())
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

export function deactivate() {
    console.log('CodeIndexer extension is now deactivated');
} 