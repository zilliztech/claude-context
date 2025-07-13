#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { CodeIndexer, SemanticSearchResult } from "@code-indexer/core";
import { OpenAIEmbedding } from "@code-indexer/core";
import { MilvusVectorDatabase } from "@code-indexer/core";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";

interface CodeIndexerMcpConfig {
    name: string;
    version: string;
    openaiApiKey: string;
    openaiBaseUrl?: string;
    milvusAddress: string;
    milvusToken?: string;
}

interface CodebaseSnapshot {
    indexedCodebases: string[];
    lastUpdated: string;
}

class CodeIndexerMcpServer {
    private server: Server;
    private codeIndexer: CodeIndexer;
    private activeCodebasePath: string | null = null;
    private indexedCodebases: string[] = [];
    private indexingStats: { indexedFiles: number; totalChunks: number } | null = null;
    private isSyncing: boolean = false;
    private snapshotFilePath: string;
    private currentWorkspace: string;

    constructor(config: CodeIndexerMcpConfig) {
        // Redirect console.log and console.warn to stderr to avoid JSON parsing issues
        // Only MCP protocol messages should go to stdout
        this.setupConsoleRedirection();

        // Get current workspace
        this.currentWorkspace = process.cwd();
        console.log(`[WORKSPACE] Current workspace: ${this.currentWorkspace}`);

        // Initialize snapshot file path
        this.snapshotFilePath = path.join(os.homedir(), '.code-indexer-mcp', 'codebase-snapshot.json');

        // Initialize MCP server
        this.server = new Server(
            {
                name: config.name,
                version: config.version
            },
            {
                capabilities: {
                    tools: {}
                }
            }
        );

        // Initialize code indexer with proper configuration
        const embedding = new OpenAIEmbedding({
            apiKey: config.openaiApiKey,
            model: 'text-embedding-3-small',
            ...(config.openaiBaseUrl && { baseURL: config.openaiBaseUrl })
        });

        const vectorDatabase = new MilvusVectorDatabase({
            address: config.milvusAddress,
            ...(config.milvusToken && { token: config.milvusToken })
        });

        this.codeIndexer = new CodeIndexer({
            embedding,
            vectorDatabase
        });

        // Load existing codebase snapshot on startup
        this.loadCodebaseSnapshot();

        this.setupTools();
    }

    private setupConsoleRedirection() {
        // Redirect console.log to stderr to avoid interfering with MCP JSON protocol
        console.log = (...args: any[]) => {
            process.stderr.write('[LOG] ' + args.join(' ') + '\n');
        };

        // Redirect console.warn to stderr
        console.warn = (...args: any[]) => {
            process.stderr.write('[WARN] ' + args.join(' ') + '\n');
        };

        // Keep console.error unchanged as it already goes to stderr
    }

    private loadCodebaseSnapshot() {
        console.log('[SNAPSHOT-DEBUG] Loading codebase snapshot from:', this.snapshotFilePath);

        try {
            if (!fs.existsSync(this.snapshotFilePath)) {
                console.log('[SNAPSHOT-DEBUG] Snapshot file does not exist. Starting with empty codebase list.');
                return;
            }

            const snapshotData = fs.readFileSync(this.snapshotFilePath, 'utf8');
            const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

            console.log('[SNAPSHOT-DEBUG] Loaded snapshot:', snapshot);

            // Validate that the codebases still exist
            const validCodebases: string[] = [];
            for (const codebasePath of snapshot.indexedCodebases) {
                if (fs.existsSync(codebasePath)) {
                    validCodebases.push(codebasePath);
                    console.log(`[SNAPSHOT-DEBUG] Validated codebase: ${codebasePath}`);
                } else {
                    console.warn(`[SNAPSHOT-DEBUG] Codebase no longer exists, removing: ${codebasePath}`);
                }
            }

            // Restore state
            this.indexedCodebases = validCodebases;

            console.log(`[SNAPSHOT-DEBUG] Restored ${validCodebases.length} codebases.`);

            // Save updated snapshot if we removed any invalid paths
            if (validCodebases.length !== snapshot.indexedCodebases.length) {
                this.saveCodebaseSnapshot();
            }

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error loading snapshot:', error);
            console.log('[SNAPSHOT-DEBUG] Starting with empty codebase list due to snapshot error.');
        }
    }

    private saveCodebaseSnapshot() {
        console.log('[SNAPSHOT-DEBUG] Saving codebase snapshot to:', this.snapshotFilePath);

        try {
            // Ensure directory exists
            const snapshotDir = path.dirname(this.snapshotFilePath);
            if (!fs.existsSync(snapshotDir)) {
                fs.mkdirSync(snapshotDir, { recursive: true });
                console.log('[SNAPSHOT-DEBUG] Created snapshot directory:', snapshotDir);
            }

            const snapshot: CodebaseSnapshot = {
                indexedCodebases: this.indexedCodebases,
                lastUpdated: new Date().toISOString()
            };

            fs.writeFileSync(this.snapshotFilePath, JSON.stringify(snapshot, null, 2));
            console.log('[SNAPSHOT-DEBUG] Snapshot saved successfully. Codebases:', this.indexedCodebases.length);

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error saving snapshot:', error);
        }
    }

    private setupTools() {
        // Define available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "index_codebase",
                        description: "Index a codebase directory for semantic search with configurable code splitter",
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Path to the codebase directory to index"
                                },
                                force: {
                                    type: "boolean",
                                    description: "Force re-indexing even if already indexed",
                                    default: false
                                },
                                splitter: {
                                    type: "string",
                                    description: "Code splitter to use: 'ast' for syntax-aware splitting with automatic fallback, 'langchain' for character-based splitting",
                                    enum: ["ast", "langchain"],
                                    default: "ast"
                                }
                            },
                            required: ["path"]
                        }
                    },
                    {
                        name: "search_code",
                        description: "Search the indexed codebase using natural language queries within specified path",
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Path to the codebase directory to search in"
                                },
                                query: {
                                    type: "string",
                                    description: "Natural language query to search for in the codebase"
                                },
                                limit: {
                                    type: "number",
                                    description: "Maximum number of results to return",
                                    default: 10,
                                    maximum: 50
                                }
                            },
                            required: ["path", "query"]
                        }
                    },
                    {
                        name: "clear_index",
                        description: "Clear the search index",
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Path to the codebase directory to clear"
                                }
                            },
                            required: ["path"]
                        }
                    }
                ]
            };
        });

        // Handle tool execution
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            switch (name) {
                case "index_codebase":
                    return await this.handleIndexCodebase(args);
                case "search_code":
                    return await this.handleSearchCode(args);
                case "clear_index":
                    return await this.handleClearIndex(args);
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        });
    }

    private async handleIndexCodebase(args: any) {
        const { path: codebasePath, force, splitter } = args;
        const forceReindex = force || false;
        const splitterType = splitter || 'ast'; // Default to AST

        try {
            // Validate splitter parameter
            if (splitterType !== 'ast' && splitterType !== 'langchain') {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Invalid splitter type '${splitterType}'. Must be 'ast' or 'langchain'.`
                    }],
                    isError: true
                };
            }
            // Force absolute path resolution - warn if relative path provided
            const absolutePath = this.ensureAbsolutePath(codebasePath);

            // Validate path exists
            if (!fs.existsSync(absolutePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' does not exist. Original input: '${codebasePath}'`
                    }],
                    isError: true
                };
            }

            // Check if it's a directory
            const stat = fs.statSync(absolutePath);
            if (!stat.isDirectory()) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' is not a directory`
                    }],
                    isError: true
                };
            }

            // Clear index if force is true
            if (forceReindex) {
                await this.codeIndexer.clearIndex(absolutePath);
            }

            // Use the existing CodeIndexer instance for indexing.
            let indexerForThisTask = this.codeIndexer;

            if (splitterType !== 'ast') {
                console.warn(`[INDEX] Non-AST splitter '${splitterType}' requested; falling back to AST splitter`);
            }

            // Initialize file synchronizer with proper ignore patterns
            const { FileSynchronizer } = await import("@code-indexer/core");
            const ignorePatterns = this.codeIndexer['ignorePatterns'] || [];
            console.log(`[INDEX] Using ignore patterns: ${ignorePatterns.join(', ')}`);
            const synchronizer = new FileSynchronizer(absolutePath, ignorePatterns);
            await synchronizer.initialize();
            // Store synchronizer in the indexer's internal map using the same collection name generation logic
            const normalizedPath = path.resolve(absolutePath);
            const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
            const collectionName = `code_chunks_${hash.substring(0, 8)}`;

            // Store synchronizer in both indexers if using a custom one
            this.codeIndexer['synchronizers'].set(collectionName, synchronizer);
            if (indexerForThisTask !== this.codeIndexer) {
                indexerForThisTask['synchronizers'].set(collectionName, synchronizer);
            }

            console.log(`[INDEX] Starting indexing with ${splitterType} splitter for: ${absolutePath}`);

            // Start indexing with the appropriate indexer
            const stats = await indexerForThisTask.indexCodebase(absolutePath);

            // Store current codebase path and stats
            if (!this.indexedCodebases.includes(absolutePath)) {
                this.indexedCodebases.push(absolutePath);
            }
            this.indexingStats = stats;

            // Save snapshot after updating codebase list
            this.saveCodebaseSnapshot();

            // Include splitter and path information in response to confirm what was actually indexed
            const pathInfo = codebasePath !== absolutePath
                ? `\nNote: Input path '${codebasePath}' was resolved to absolute path '${absolutePath}'`
                : '';

            return {
                content: [{
                    type: "text",
                    text: `Successfully indexed codebase '${absolutePath}' using ${splitterType.toUpperCase()} splitter.\nIndexed ${stats.indexedFiles} files, ${stats.totalChunks} chunks.${pathInfo}`
                }]
            };
        } catch (error: any) {
            console.error('Error during indexing:', error);
            return {
                content: [{
                    type: "text",
                    text: `Error indexing codebase: ${error.message}`
                }],
                isError: true
            };
        }
    }

    private async handleSyncIndex() {
        const syncStartTime = Date.now();
        console.log(`[SYNC-DEBUG] handleSyncIndex() called at ${new Date().toISOString()}`);

        if (this.indexedCodebases.length === 0) {
            console.log('[SYNC-DEBUG] No codebases indexed. Skipping sync.');
            return;
        }

        console.log(`[SYNC-DEBUG] Found ${this.indexedCodebases.length} indexed codebases:`, this.indexedCodebases);
        console.log(`[SYNC-DEBUG] Active codebase: ${this.activeCodebasePath || 'none'}`);

        if (this.isSyncing) {
            console.log('[SYNC-DEBUG] Index sync already in progress. Skipping.');
            return;
        }

        this.isSyncing = true;
        console.log(`[SYNC-DEBUG] Starting index sync for all ${this.indexedCodebases.length} codebases...`);

        try {
            let totalStats = { added: 0, removed: 0, modified: 0 };

            for (let i = 0; i < this.indexedCodebases.length; i++) {
                const codebasePath = this.indexedCodebases[i];
                const codebaseStartTime = Date.now();

                console.log(`[SYNC-DEBUG] [${i + 1}/${this.indexedCodebases.length}] Starting sync for codebase: '${codebasePath}'`);

                // Check if codebase path still exists
                try {
                    const pathExists = fs.existsSync(codebasePath);
                    console.log(`[SYNC-DEBUG] Codebase path exists: ${pathExists}`);

                    if (!pathExists) {
                        console.warn(`[SYNC-DEBUG] Codebase path '${codebasePath}' no longer exists. Skipping sync.`);
                        continue;
                    }
                } catch (pathError: any) {
                    console.error(`[SYNC-DEBUG] Error checking codebase path '${codebasePath}':`, pathError);
                    continue;
                }

                try {
                    console.log(`[SYNC-DEBUG] Calling codeIndexer.reindexByChange() for '${codebasePath}'`);
                    const stats = await this.codeIndexer.reindexByChange(codebasePath);
                    const codebaseElapsed = Date.now() - codebaseStartTime;

                    console.log(`[SYNC-DEBUG] Reindex stats for '${codebasePath}':`, stats);
                    console.log(`[SYNC-DEBUG] Codebase sync completed in ${codebaseElapsed}ms`);

                    // Accumulate total stats
                    totalStats.added += stats.added;
                    totalStats.removed += stats.removed;
                    totalStats.modified += stats.modified;

                    if (stats.added > 0 || stats.removed > 0 || stats.modified > 0) {
                        console.log(`[SYNC] Sync complete for '${codebasePath}'. Added: ${stats.added}, Removed: ${stats.removed}, Modified: ${stats.modified} (${codebaseElapsed}ms)`);
                    } else {
                        console.log(`[SYNC] No changes detected for '${codebasePath}' (${codebaseElapsed}ms)`);
                    }
                } catch (error: any) {
                    const codebaseElapsed = Date.now() - codebaseStartTime;
                    console.error(`[SYNC-DEBUG] Error syncing codebase '${codebasePath}' after ${codebaseElapsed}ms:`, error);
                    console.error(`[SYNC-DEBUG] Error stack:`, error.stack);

                    // Log additional error details
                    if (error.code) {
                        console.error(`[SYNC-DEBUG] Error code: ${error.code}`);
                    }
                    if (error.errno) {
                        console.error(`[SYNC-DEBUG] Error errno: ${error.errno}`);
                    }

                    // Continue with next codebase even if one fails
                }
            }

            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG] Total sync stats across all codebases: Added: ${totalStats.added}, Removed: ${totalStats.removed}, Modified: ${totalStats.modified}`);
            console.log(`[SYNC-DEBUG] Index sync completed for all codebases in ${totalElapsed}ms`);
            console.log(`[SYNC] Index sync completed for all codebases. Total changes - Added: ${totalStats.added}, Removed: ${totalStats.removed}, Modified: ${totalStats.modified}`);
        } catch (error: any) {
            const totalElapsed = Date.now() - syncStartTime;
            console.error(`[SYNC-DEBUG] Error during index sync after ${totalElapsed}ms:`, error);
            console.error(`[SYNC-DEBUG] Error stack:`, error.stack);
        } finally {
            this.isSyncing = false;
            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG] handleSyncIndex() finished at ${new Date().toISOString()}, total duration: ${totalElapsed}ms`);
        }
    }

    private async handleSearchCode(args: any) {
        const { path: codebasePath, query, limit = 10 } = args;
        const resultLimit = limit || 10;

        try {
            // Force absolute path resolution - warn if relative path provided
            const absolutePath = this.ensureAbsolutePath(codebasePath);

            // Validate path exists
            if (!fs.existsSync(absolutePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' does not exist. Original input: '${codebasePath}'`
                    }],
                    isError: true
                };
            }

            // Check if it's a directory
            const stat = fs.statSync(absolutePath);
            if (!stat.isDirectory()) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' is not a directory`
                    }],
                    isError: true
                };
            }

            // Check if this codebase is indexed
            if (!this.indexedCodebases.includes(absolutePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Codebase '${absolutePath}' is not indexed. Please index it first.`
                    }],
                    isError: true
                };
            }

            console.log(`[SEARCH] Searching in codebase: ${absolutePath}`);

            // Search in the specified codebase
            const searchResults = await this.codeIndexer.semanticSearch(
                absolutePath,
                query,
                Math.min(resultLimit, 50),
                0.3
            );

            if (searchResults.length === 0) {
                return {
                    content: [{
                        type: "text",
                        text: `No results found for query: "${query}" in codebase '${absolutePath}'`
                    }]
                };
            }

            // Format results
            const formattedResults = searchResults.map((result: any, index: number) => {
                const location = `${result.relativePath}:${result.startLine}`;
                const context = this.truncateContent(result.content, 150);
                const codebaseInfo = path.basename(absolutePath);

                return `${index + 1}. Code snippet (${result.language}) [${codebaseInfo}]\n` +
                    `   Location: ${location}\n` +
                    `   Score: ${result.score.toFixed(3)}\n` +
                    `   Context: ${context}\n`;
            }).join('\n');

            return {
                content: [{
                    type: "text",
                    text: `Found ${searchResults.length} results for query: "${query}" in codebase '${absolutePath}'\n\n${formattedResults}`
                }]
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                    type: "text",
                    text: `Error searching code: ${errorMessage}`
                }],
                isError: true
            };
        }
    }

    private async handleClearIndex(args: any) {
        const { path: codebasePath } = args;

        if (this.indexedCodebases.length === 0) {
            return {
                content: [{
                    type: "text",
                    text: "No codebases are currently indexed."
                }]
            };
        }

        try {
            // Force absolute path resolution - warn if relative path provided
            const absolutePath = this.ensureAbsolutePath(codebasePath);

            // Validate path exists
            if (!fs.existsSync(absolutePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' does not exist. Original input: '${codebasePath}'`
                    }],
                    isError: true
                };
            }

            // Check if it's a directory
            const stat = fs.statSync(absolutePath);
            if (!stat.isDirectory()) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' is not a directory`
                    }],
                    isError: true
                };
            }

            // Check if this codebase is indexed
            if (!this.indexedCodebases.includes(absolutePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Codebase '${absolutePath}' is not indexed.`
                    }],
                    isError: true
                };
            }

            console.log(`[CLEAR] Clearing codebase: ${absolutePath}`);

            try {
                await this.codeIndexer.clearIndex(absolutePath);
                console.log(`[CLEAR] Successfully cleared index for: ${absolutePath}`);
            } catch (error: any) {
                const errorMsg = `Failed to clear ${absolutePath}: ${error.message}`;
                console.error(`[CLEAR] ${errorMsg}`);
                return {
                    content: [{
                        type: "text",
                        text: errorMsg
                    }],
                    isError: true
                };
            }

            // Remove the cleared codebase from the list
            this.indexedCodebases = this.indexedCodebases.filter(codebasePath =>
                codebasePath !== absolutePath
            );

            // Reset active codebase if it was cleared
            if (this.activeCodebasePath === absolutePath) {
                this.activeCodebasePath = null;
                this.indexingStats = null;
            }

            // Save snapshot after clearing index
            this.saveCodebaseSnapshot();

            let resultText = `Successfully cleared codebase '${absolutePath}'`;

            if (this.indexedCodebases.length > 0) {
                resultText += `\n${this.indexedCodebases.length} other codebase(s) remain indexed`;
            }

            return {
                content: [{
                    type: "text",
                    text: resultText
                }]
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                    type: "text",
                    text: `Error clearing index: ${errorMessage}`
                }],
                isError: true
            };
        }
    }

    /**
     * Truncate content to specified length
     */
    private truncateContent(content: string, maxLength: number): string {
        if (content.length <= maxLength) {
            return content;
        }
        return content.substring(0, maxLength) + '...';
    }

    private startBackgroundSync() {
        console.log('[SYNC-DEBUG] startBackgroundSync() called');

        // Execute initial sync immediately after a short delay to let server initialize
        console.log('[SYNC-DEBUG] Scheduling initial sync in 5 seconds...');
        setTimeout(() => {
            console.log('[SYNC-DEBUG] Executing initial sync after server startup');
            this.handleSyncIndex();
        }, 5000); // Initial sync after 5 seconds

        // Periodically check for file changes and update the index
        console.log('[SYNC-DEBUG] Setting up periodic sync every 5 minutes (300000ms)');
        const syncInterval = setInterval(() => {
            console.log('[SYNC-DEBUG] Executing scheduled periodic sync');
            this.handleSyncIndex();
        }, 5 * 60 * 1000); // every 5 minutes

        console.log('[SYNC-DEBUG] Background sync setup complete. Interval ID:', syncInterval);
    }

    async start() {
        console.log('[SYNC-DEBUG] MCP server start() method called');
        console.log('Starting CodeIndexer MCP server...');

        const transport = new StdioServerTransport();
        console.log('[SYNC-DEBUG] StdioServerTransport created, attempting server connection...');

        await this.server.connect(transport);
        console.log("MCP server started and listening on stdio.");
        console.log('[SYNC-DEBUG] Server connection established successfully');

        // Start background sync after server is connected
        console.log('[SYNC-DEBUG] Initializing background sync...');
        this.startBackgroundSync();
        console.log('[SYNC-DEBUG] MCP server initialization complete');
    }

    /**
     * Ensure path is absolute. If relative path is provided, resolve it properly.
     * This method addresses the issue where relative paths in MCP context may not resolve correctly.
     */
    private ensureAbsolutePath(inputPath: string): string {
        // If already absolute, return as is
        if (path.isAbsolute(inputPath)) {
            return inputPath;
        }

        // For relative paths, we need to be more careful
        // Log a warning about potential path resolution issues
        console.warn(`Relative path detected: '${inputPath}'. Converting to absolute path.`);

        // Common relative path patterns that might indicate user intent
        if (inputPath === '.' || inputPath === './') {
            console.warn(`Current directory reference detected. This may not resolve to the directory you expect in MCP context.`);
        }

        // Try to resolve relative to current working directory
        const resolved = path.resolve(inputPath);
        console.warn(`Resolved relative path '${inputPath}' to '${resolved}'. If this is incorrect, please provide an absolute path.`);

        return resolved;
    }
}

// Main execution
async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);

    const config: CodeIndexerMcpConfig = {
        name: process.env.MCP_SERVER_NAME || "CodeIndexer MCP Server",
        version: process.env.MCP_SERVER_VERSION || "1.0.0",
        openaiApiKey: process.env.OPENAI_API_KEY || "",
        openaiBaseUrl: process.env.OPENAI_BASE_URL,
        milvusAddress: process.env.MILVUS_ADDRESS || "localhost:19530",
        milvusToken: process.env.MILVUS_TOKEN
    };

    // Show help if requested
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
CodeIndexer MCP Server

Usage: npx @code-indexer/mcp@latest [options]

Options:
  --help, -h                          Show this help message

Environment Variables:
  MCP_SERVER_NAME         Server name
  MCP_SERVER_VERSION      Server version
  OPENAI_API_KEY          OpenAI API key (required)
  OPENAI_BASE_URL         OpenAI API base URL (optional, for custom endpoints)
  MILVUS_ADDRESS          Milvus address (default: localhost:19530)
  MILVUS_TOKEN            Milvus token (optional)

Examples:
  # Start MCP server
  npx @code-indexer/mcp@latest
        `);
        process.exit(0);
    }

    const server = new CodeIndexerMcpServer(config);
    await server.start();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.error("Received SIGINT, shutting down gracefully...");
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.error("Received SIGTERM, shutting down gracefully...");
    process.exit(0);
});

// Always start the server - this is designed to be the main entry point
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});