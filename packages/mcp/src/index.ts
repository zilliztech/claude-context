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

interface CodeIndexerMcpConfig {
    name: string;
    version: string;
    openaiApiKey: string;
    milvusAddress: string;
    milvusToken?: string;
}

class CodeIndexerMcpServer {
    private server: Server;
    private codeIndexer: CodeIndexer;
    private activeCodebasePath: string | null = null;
    private indexedCodebases: string[] = [];
    private indexingStats: { indexedFiles: number; totalChunks: number } | null = null;
    private isSyncing: boolean = false;
    private stateFilePath: string;

    constructor(config: CodeIndexerMcpConfig) {
        // Redirect console.log and console.warn to stderr to avoid JSON parsing issues
        // Only MCP protocol messages should go to stdout
        this.setupConsoleRedirection();

        const stateDir = path.join(os.homedir(), '.codeindexer');
        fs.mkdirSync(stateDir, { recursive: true });
        this.stateFilePath = path.join(stateDir, 'mcp_state.json');

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
            model: 'text-embedding-3-small'
        });

        const vectorDatabase = new MilvusVectorDatabase({
            address: config.milvusAddress,
            ...(config.milvusToken && { token: config.milvusToken })
        });

        this.codeIndexer = new CodeIndexer({
            embedding,
            vectorDatabase
        });

        this.setupTools();
        this.loadState();
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

    private async saveState(): Promise<void> {
        const state = {
            activeCodebasePath: this.activeCodebasePath,
            indexedCodebases: this.indexedCodebases,
            indexingStats: this.indexingStats
        };
        try {
            await fs.promises.writeFile(this.stateFilePath, JSON.stringify(state, null, 2));
            console.log(`Saved MCP state to ${this.stateFilePath}`);
        } catch (error) {
            console.error('Failed to save MCP state:', error);
        }
    }

    private loadState(): void {
        try {
            if (fs.existsSync(this.stateFilePath)) {
                const stateJson = fs.readFileSync(this.stateFilePath, 'utf-8');
                const state = JSON.parse(stateJson);
                this.activeCodebasePath = state.activeCodebasePath || null;
                this.indexedCodebases = state.indexedCodebases || [];
                this.indexingStats = state.indexingStats || null;
                if(this.activeCodebasePath) {
                    console.log(`Loaded MCP state from ${this.stateFilePath}. Active codebase: ${this.activeCodebasePath}`);
                }
            }
        } catch (error) {
            console.error('Failed to load MCP state:', error);
            // Reset state if file is corrupt
            this.activeCodebasePath = null;
            this.indexedCodebases = [];
            this.indexingStats = null;
        }
    }

    private setupTools() {
        // Define available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "index_codebase",
                        description: "Index a codebase directory for semantic search",
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
                                }
                            },
                            required: ["path"]
                        }
                    },
                    {
                        name: "switch_codebase",
                        description: "Switch the active codebase for search and sync",
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Path to the codebase to switch to"
                                }
                            },
                            required: ["path"]
                        }
                    },
                    {
                        name: "list_indexed_codebases",
                        description: "List all indexed codebases",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            required: []
                        }
                    },
                    {
                        name: "search_code",
                        description: "Search the indexed codebase using natural language queries",
                        inputSchema: {
                            type: "object",
                            properties: {
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
                            required: ["query"]
                        }
                    },
                    {
                        name: "clear_index",
                        description: "Clear the search index",
                        inputSchema: {
                            type: "object",
                            properties: {
                                confirm: {
                                    type: "boolean",
                                    description: "Confirmation flag to prevent accidental clearing"
                                }
                            },
                            required: ["confirm"]
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
                case "switch_codebase":
                    return await this.handleSwitchCodebase(args);
                case "list_indexed_codebases":
                    return await this.handleListCodebases();
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
        const { path: codebasePath, force } = args;
        const forceReindex = force || false;

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

            // Clear index if force is true
            if (forceReindex && this.activeCodebasePath) {
                await this.codeIndexer.clearIndex(this.activeCodebasePath);
            }

            // Start indexing
            const stats = await this.codeIndexer.indexCodebase(absolutePath);

            // Store current codebase path and stats
            this.activeCodebasePath = absolutePath;
            if (!this.indexedCodebases.includes(absolutePath)) {
                this.indexedCodebases.push(absolutePath);
            }
            this.indexingStats = stats;
            await this.saveState();

            // Include path information in response to confirm what was actually indexed
            const pathInfo = codebasePath !== absolutePath 
                ? `\nNote: Input path '${codebasePath}' was resolved to absolute path '${absolutePath}'`
                : '';

            return {
                content: [{
                    type: "text",
                    text: `Successfully indexed codebase '${absolutePath}'.\nIndexed ${stats.indexedFiles} files, ${stats.totalChunks} chunks.${pathInfo}`
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

    private async handleSwitchCodebase(args: any) {
        const { path: codebasePath } = args;
        const absolutePath = this.ensureAbsolutePath(codebasePath);

        if (!this.indexedCodebases.includes(absolutePath)) {
            return {
                content: [{
                    type: "text",
                    text: `Error: Codebase '${absolutePath}' is not indexed. Please index it first.`
                }],
                isError: true
            };
        }

        this.activeCodebasePath = absolutePath;
        await this.saveState();

        return {
            content: [{
                type: "text",
                text: `Switched active codebase to '${absolutePath}'`
            }]
        };
    }

    private async handleListCodebases() {
        if (this.indexedCodebases.length === 0) {
            return {
                content: [{
                    type: "text",
                    text: "No codebases have been indexed yet."
                }]
            };
        }

        const codebaseList = this.indexedCodebases.map(p => 
            p === this.activeCodebasePath ? `* ${p} (active)` : `  ${p}`
        ).join('\n');

        return {
            content: [{
                type: "text",
                text: `Available codebases:\n${codebaseList}`
            }]
        };
    }

    private async handleSyncIndex() {
        if (!this.activeCodebasePath) {
            // Silently return if no codebase is indexed
            return;
        }

        if (this.isSyncing) {
            console.log('Index sync already in progress. Skipping.');
            return;
        }

        this.isSyncing = true;
        console.log(`Starting index sync for '${this.activeCodebasePath}'...`);

        try {
            const stats = await this.codeIndexer.reindexByChange(this.activeCodebasePath);
            if (stats.added > 0 || stats.removed > 0 || stats.modified > 0) {
                console.log(`Index sync complete. Added: ${stats.added}, Removed: ${stats.removed}, Modified: ${stats.modified}`);
            } else {
                console.log('No changes detected for index sync.');
            }
        } catch (error: any) {
            console.error('Error during index sync:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    private async handleSearchCode(args: any) {
        const { query, limit = 10 } = args;
        const resultLimit = limit || 10;

        try {
            // Check if we have a current codebase path
            if (!this.activeCodebasePath) {
                return {
                    content: [{
                        type: "text",
                        text: "Error: No codebase has been indexed yet. Please index a codebase first."
                    }],
                    isError: true
                };
            }

            const searchResults = await this.codeIndexer.semanticSearch(
                this.activeCodebasePath,
                query,
                Math.min(resultLimit, 50),
                0.3
            );

            if (searchResults.length === 0) {
                return {
                    content: [{
                        type: "text",
                        text: `No results found for query: "${query}"`
                    }]
                };
            }

            // Format results
            const formattedResults = searchResults.map((result: SemanticSearchResult, index: number) => {
                const location = `${result.relativePath}:${result.startLine}`;
                const context = this.truncateContent(result.content, 150);

                return `${index + 1}. Code snippet (${result.language})\n` +
                    `   Location: ${location}\n` +
                    `   Score: ${result.score.toFixed(3)}\n` +
                    `   Context: ${context}\n`;
            }).join('\n');

            return {
                content: [{
                    type: "text",
                    text: `Found ${searchResults.length} results for query: "${query}"\n\n${formattedResults}`
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
        const { confirm } = args;

        if (!confirm) {
            return {
                content: [{
                    type: "text",
                    text: "Index clearing cancelled. Set 'confirm' to true to proceed."
                }]
            };
        }

        if (!this.activeCodebasePath) {
            return {
                content: [{
                    type: "text",
                    text: "No codebase is currently indexed."
                }]
            };
        }

        try {
            const pathToClear = this.activeCodebasePath;
            await this.codeIndexer.clearIndex(pathToClear);

            // Reset state
            this.indexedCodebases = this.indexedCodebases.filter(p => p !== pathToClear);
            this.activeCodebasePath = null;
            this.indexingStats = null;
            await this.saveState();

            return {
                content: [{
                    type: "text",
                    text: "Index cleared successfully"
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
        // Periodically check for file changes and update the index
        setInterval(() => this.handleSyncIndex(), 300 * 1000); // every 5 minutes
    }

    async start() {
        console.log('Starting CodeIndexer MCP server...');
        this.startBackgroundSync();
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.log("MCP server started and listening on stdio.");
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
  MILVUS_ADDRESS          Milvus address (default: localhost:19530)

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

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}