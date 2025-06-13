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
    private currentCodebasePath: string | null = null;
    private indexingStats: { indexedFiles: number; totalChunks: number } | null = null;

    constructor(config: CodeIndexerMcpConfig) {
        // Redirect console.log and console.warn to stderr to avoid JSON parsing issues
        // Only MCP protocol messages should go to stdout
        this.setupConsoleRedirection();

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
                        name: "get_stats",
                        description: "Get indexing statistics",
                        inputSchema: {
                            type: "object",
                            properties: {}
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
                    },
                    {
                        name: "get_file_content",
                        description: "Retrieve the content of a specific file",
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Path to the file to read"
                                },
                                startLine: {
                                    type: "number",
                                    description: "Start line number (1-based)"
                                },
                                endLine: {
                                    type: "number",
                                    description: "End line number (1-based)"
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
                case "get_stats":
                    return await this.handleGetStats();
                case "clear_index":
                    return await this.handleClearIndex(args);
                case "get_file_content":
                    return await this.handleGetFileContent(args);
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        });
    }

    private async handleIndexCodebase(args: any) {
        const { path: codebasePath, force } = args;
        const forceReindex = force || false;

        try {
            // Validate path exists
            if (!fs.existsSync(codebasePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${codebasePath}' does not exist`
                    }],
                    isError: true
                };
            }

            // Check if it's a directory
            const stat = fs.statSync(codebasePath);
            if (!stat.isDirectory()) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${codebasePath}' is not a directory`
                    }],
                    isError: true
                };
            }

            const absolutePath = path.resolve(codebasePath);

            // Clear index if force is true
            if (forceReindex && this.currentCodebasePath) {
                await this.codeIndexer.clearIndex(this.currentCodebasePath);
            }

            // Start indexing
            const stats = await this.codeIndexer.indexCodebase(absolutePath);

            // Store current codebase path and stats
            this.currentCodebasePath = absolutePath;
            this.indexingStats = stats;

            return {
                content: [{
                    type: "text",
                    text: `Successfully indexed codebase at '${absolutePath}'\n` +
                        `Indexed files: ${stats.indexedFiles}\n` +
                        `Total chunks: ${stats.totalChunks}`
                }]
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                    type: "text",
                    text: `Error indexing codebase: ${errorMessage}`
                }],
                isError: true
            };
        }
    }

    private async handleSearchCode(args: any) {
        const { query, limit } = args;
        const resultLimit = limit || 10;

        try {
            // Check if we have a current codebase path
            if (!this.currentCodebasePath) {
                return {
                    content: [{
                        type: "text",
                        text: "Error: No codebase has been indexed yet. Please index a codebase first."
                    }],
                    isError: true
                };
            }

            const searchResults = await this.codeIndexer.semanticSearch(
                this.currentCodebasePath,
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

    private async handleGetStats() {
        try {
            if (!this.indexingStats) {
                return {
                    content: [{
                        type: "text",
                        text: "No indexing statistics available. Please index a codebase first."
                    }]
                };
            }

            return {
                content: [{
                    type: "text",
                    text: `Indexing Statistics:\n` +
                        `- Current codebase: ${this.currentCodebasePath || 'None'}\n` +
                        `- Indexed files: ${this.indexingStats.indexedFiles}\n` +
                        `- Total chunks: ${this.indexingStats.totalChunks}`
                }]
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                    type: "text",
                    text: `Error getting stats: ${errorMessage}`
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

        if (!this.currentCodebasePath) {
            return {
                content: [{
                    type: "text",
                    text: "No codebase is currently indexed."
                }]
            };
        }

        try {
            await this.codeIndexer.clearIndex(this.currentCodebasePath);

            // Reset state
            this.currentCodebasePath = null;
            this.indexingStats = null;

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

    private async handleGetFileContent(args: any) {
        const { path: filePath, startLine, endLine } = args;

        try {
            // Validate file exists
            if (!fs.existsSync(filePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: File '${filePath}' does not exist`
                    }],
                    isError: true
                };
            }

            // Read file content
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            // Apply line range if specified
            let displayContent = content;
            if (startLine !== undefined || endLine !== undefined) {
                const start = Math.max(0, (startLine || 1) - 1);
                const end = endLine ? Math.min(lines.length, endLine) : lines.length;

                if (start >= lines.length) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error: Start line ${startLine} exceeds file length (${lines.length} lines)`
                        }],
                        isError: true
                    };
                }

                const selectedLines = lines.slice(start, end);
                displayContent = selectedLines.map((line, index) =>
                    `${start + index + 1}: ${line}`
                ).join('\n');
            }

            return {
                content: [{
                    type: "text",
                    text: `File: ${filePath}\n` +
                        `${startLine || endLine ? `Lines ${startLine || 1}-${endLine || lines.length}:\n` : ''}\n` +
                        displayContent
                }]
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                    type: "text",
                    text: `Error reading file: ${errorMessage}`
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

    async start() {
        try {
            const transport = new StdioServerTransport();
            await this.server.connect(transport);
            console.error("CodeIndexer MCP Server started successfully (stdio)");
        } catch (error) {
            console.error("Failed to start CodeIndexer MCP Server:", error);
            process.exit(1);
        }
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