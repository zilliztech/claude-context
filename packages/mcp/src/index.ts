#!/usr/bin/env node

// CRITICAL: Redirect console outputs to stderr IMMEDIATELY to avoid interfering with MCP JSON protocol
// Only MCP protocol messages should go to stdout
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

console.log = (...args: any[]) => {
    process.stderr.write('[LOG] ' + args.join(' ') + '\n');
};

console.warn = (...args: any[]) => {
    process.stderr.write('[WARN] ' + args.join(' ') + '\n');
};

// console.error already goes to stderr by default

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { CodeContext } from "@zilliz/code-context-core";
import { MilvusVectorDatabase } from "@zilliz/code-context-core";

// Import our modular components
import { createMcpConfig, logConfigurationSummary, showHelpMessage, CodeContextMcpConfig } from "./config.js";
import { createEmbeddingInstance, logEmbeddingProviderInfo } from "./embedding.js";
import { SnapshotManager } from "./snapshot.js";
import { SyncManager } from "./sync.js";
import { ToolHandlers } from "./handlers.js";

class CodeContextMcpServer {
    private server: Server;
    private codeContext: CodeContext;
    private snapshotManager: SnapshotManager;
    private syncManager: SyncManager;
    private toolHandlers: ToolHandlers;

    constructor(config: CodeContextMcpConfig) {
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

        // Initialize embedding provider
        console.log(`[EMBEDDING] Initializing embedding provider: ${config.embeddingProvider}`);
        console.log(`[EMBEDDING] Using model: ${config.embeddingModel}`);

        const embedding = createEmbeddingInstance(config);
        logEmbeddingProviderInfo(config, embedding);

        // Initialize vector database
        const vectorDatabase = new MilvusVectorDatabase({
            address: config.milvusAddress,
            ...(config.milvusToken && { token: config.milvusToken })
        });

        // Initialize code context
        this.codeContext = new CodeContext({
            embedding,
            vectorDatabase
        });

        // Initialize managers
        this.snapshotManager = new SnapshotManager();
        this.syncManager = new SyncManager(this.codeContext, this.snapshotManager);
        this.toolHandlers = new ToolHandlers(this.codeContext, this.snapshotManager);

        // Load existing codebase snapshot on startup
        this.snapshotManager.loadCodebaseSnapshot();

        this.setupTools();
    }

    private setupTools() {
        // Get current working directory to provide to LLM
        const currentWorkingDirectory = process.cwd();

        const index_description = `
Index a codebase directory to enable semantic search using a configurable code splitter.

⚠️ **IMPORTANT**:
- You MUST provide an absolute path to the target codebase.
- Relative paths will be automatically resolved to absolute paths.
- Current working directory: ${currentWorkingDirectory}.
    You may use this directly or append subfolders (e.g., ${currentWorkingDirectory}/subfolder).

✨ **Usage Guidance**:
- This tool is typically used when search fails due to an unindexed codebase.
- If indexing is attempted on an already indexed path, and a conflict is detected, you MUST prompt the user to confirm whether to proceed with a force index (i.e., re-indexing and overwriting the previous index).
`;


        const search_description = `
Search the indexed codebase using natural language queries within a specified absolute path.

⚠️ **IMPORTANT**:
- You MUST provide an absolute path.
- The current working directory is: ${currentWorkingDirectory}.
- You can use this as the default path or customize it (e.g., ${currentWorkingDirectory}/subfolder).

✨ **Usage Guidance**:
- If the codebase is not indexed, this tool will return a clear error message indicating that indexing is required first.
- You can then use the index_codebase tool to index the codebase before searching again.
`;

        // Define available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "index_codebase",
                        description: index_description,
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: `ABSOLUTE path to the codebase directory to index. Current working directory is: ${currentWorkingDirectory}. You can use this path directly or adjust as needed.`
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
                                },
                                ignorePatterns: {
                                    type: "array",
                                    items: {
                                        type: "string"
                                    },
                                    description: "Optional: Additional ignore patterns to exclude specific files/directories beyond defaults. Only include this parameter if the user explicitly requests custom ignore patterns (e.g., ['static/**', '*.tmp', 'private/**'])",
                                    default: []
                                }
                            },
                            required: ["path"]
                        }
                    },
                    {
                        name: "search_code",
                        description: search_description,
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: `ABSOLUTE path to the codebase directory to search in. Current working directory is: ${currentWorkingDirectory}. You can use this path directly or adjust as needed.`
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
                        description: `Clear the search index. IMPORTANT: You MUST provide an absolute path. Current working directory is: ${currentWorkingDirectory}. You can use this as the default path or adjust as needed (e.g., ${currentWorkingDirectory}/subfolder).`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: `ABSOLUTE path to the codebase directory to clear. Current working directory is: ${currentWorkingDirectory}. You can use this path directly or adjust as needed.`
                                }
                            },
                            required: ["path"]
                        }
                    },
                ]
            };
        });

        // Handle tool execution
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            switch (name) {
                case "index_codebase":
                    return await this.toolHandlers.handleIndexCodebase(args);
                case "search_code":
                    return await this.toolHandlers.handleSearchCode(args);
                case "clear_index":
                    return await this.toolHandlers.handleClearIndex(args);

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        });
    }

    async start() {
        console.log('[SYNC-DEBUG] MCP server start() method called');
        console.log('Starting CodeContext MCP server...');

        const transport = new StdioServerTransport();
        console.log('[SYNC-DEBUG] StdioServerTransport created, attempting server connection...');

        await this.server.connect(transport);
        console.log("MCP server started and listening on stdio.");
        console.log('[SYNC-DEBUG] Server connection established successfully');

        // Start background sync after server is connected
        console.log('[SYNC-DEBUG] Initializing background sync...');
        this.syncManager.startBackgroundSync();
        console.log('[SYNC-DEBUG] MCP server initialization complete');
    }
}

// Main execution
async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);

    // Show help if requested
    if (args.includes('--help') || args.includes('-h')) {
        showHelpMessage();
        process.exit(0);
    }

    // Create configuration
    const config = createMcpConfig();
    logConfigurationSummary(config);

    const server = new CodeContextMcpServer(config);
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