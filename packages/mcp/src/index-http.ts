import express from "express";
import { z } from "zod";
import {
    McpServer,
    ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    StreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    SSEServerTransport,
} from "@modelcontextprotocol/sdk/server/sse.js";
import { Context } from "@zilliz/claude-context-core";
import { MilvusVectorDatabase } from "@zilliz/claude-context-core";

import {
    createMcpConfig,
    logConfigurationSummary,
    showHelpMessage,
    ContextMcpConfig,
} from "./config.js";
import {
    createEmbeddingInstance,
    logEmbeddingProviderInfo,
} from "./embedding.js";
import { SnapshotManager } from "./snapshot.js";
import { SyncManager } from "./sync.js";
import { ToolHandlers } from "./handlers.js";

class ContextMcpHttpServer {
    private server: McpServer;
    private context: Context;
    private snapshotManager: SnapshotManager;
    private syncManager: SyncManager;
    private toolHandlers: ToolHandlers;
    private config: ContextMcpConfig;

    constructor(config: ContextMcpConfig) {
        this.config = config;

        console.log(`[INIT] Starting MCP server "${config.name}" v${config.version}`);

        // --- Initialize MCP core ---
        this.server = new McpServer({
            name: config.name,
            version: config.version,
        });

        // --- Embedding Provider ---
        console.log(`[EMBEDDING] Provider: ${config.embeddingProvider}`);
        console.log(`[EMBEDDING] Model: ${config.embeddingModel}`);

        const embedding = createEmbeddingInstance(config);
        logEmbeddingProviderInfo(config, embedding);

        // --- Vector DB (Milvus) ---
        const vectorDatabase = new MilvusVectorDatabase({
            address: config.milvusAddress,
            ...(config.milvusToken && { token: config.milvusToken }),
        });

        // --- Claude Context ---
        this.context = new Context({
            embedding,
            vectorDatabase,
        });

        // --- Managers ---
        this.snapshotManager = new SnapshotManager();
        this.syncManager = new SyncManager(this.context, this.snapshotManager);
        this.toolHandlers = new ToolHandlers(this.context, this.snapshotManager);

        // --- Load snapshot if exists ---
        this.snapshotManager.loadCodebaseSnapshot();

        // --- Register tools & resources ---
        this.setupTools();
    }

    private setupTools() {
        const index_description = `
Index a codebase directory to enable semantic search using a configurable code splitter.

⚠️ **IMPORTANT**:
- You MUST provide an absolute path to the target codebase.

✨ **Usage Guidance**:
- This tool is typically used when search fails due to an unindexed codebase.
- If indexing is attempted on an already indexed path, and a conflict is detected, you MUST prompt the user to confirm whether to proceed with a force index (i.e., re-indexing and overwriting the previous index).
`;

        const search_description = `
Search the indexed codebase using natural language queries within a specified absolute path.

⚠️ **IMPORTANT**:
- You MUST provide an absolute path.

🎯 **When to Use**:
This tool is versatile and can be used before completing various tasks to retrieve relevant context:
- **Code search**: Find specific functions, classes, or implementations
- **Context-aware assistance**: Gather relevant code context before making changes
- **Issue identification**: Locate problematic code sections or bugs
- **Code review**: Understand existing implementations and patterns
- **Refactoring**: Find all related code pieces that need to be updated
- **Feature development**: Understand existing architecture and similar implementations
- **Duplicate detection**: Identify redundant or duplicated code patterns across the codebase

✨ **Usage Guidance**:
- If the codebase is not indexed, this tool will return a clear error message indicating that indexing is required first.
- You can then use the index_codebase tool to index the codebase before searching again.
`;

        this.server.registerTool(
            "index_codebase",
            {
                description: index_description,
                inputSchema: {
                    path: z.string().describe("Absolute path to the codebase directory to index."),
                    force: z.boolean().default(false),
                    splitter: z.enum(["ast", "langchain"]).default("ast"),
                    customExtensions: z.array(z.string()).default([]),
                    ignorePatterns: z.array(z.string()).default([]),
                },
            },
            async (args, _extra): Promise<{
                content: { type: "text"; text: string }[];
                isError?: boolean;
            }> => {
                const result = await this.toolHandlers.handleIndexCodebase(args);

                // Wrapper: force the type of `type` to be "text" literal
                const wrappedContent = result.content.map(item => ({
                    ...item,
                    type: "text" as const,
                }));

                return {
                    ...result,
                    content: wrappedContent,
                };
            }
        );

        this.server.registerTool(
            "search_code",
            {
                description: search_description,
                inputSchema: {
                    path: z.string(),
                    query: z.string(),
                    limit: z.number().max(50).default(10),
                    extensionFilter: z.array(z.string()).default([]),
                },
            },
            async (args, _extra): Promise<{
                content: { type: "text"; text: string }[];
                isError?: boolean;
            }> => {
                const result = await this.toolHandlers.handleSearchCode(args);

                // Wrapper: force the type of `type` to be "text" literal
                const wrappedContent = result.content.map(item => ({
                    ...item,
                    type: "text" as const,
                }));

                return {
                    ...result,
                    content: wrappedContent,
                };
            }
        );

        this.server.registerTool(
            "clear_index",
            {
                description: "Clear the index for a given codebase path.",
                inputSchema: {
                    path: z.string(),
                },
            },
            async (args, _extra): Promise<{
                content: { type: "text"; text: string }[];
                isError?: boolean;
            }> => {
                const result = await this.toolHandlers.handleClearIndex(args);

                // Wrapper: force the type of `type` to be "text" literal
                const wrappedContent = result.content.map(item => ({
                    ...item,
                    type: "text" as const,
                }));

                return {
                    ...result,
                    content: wrappedContent,
                };
            }
        );

        this.server.registerTool(
            "get_indexing_status",
            {
                description: "Get the current indexing status for a codebase path.",
                inputSchema: {
                    path: z.string(),
                },
            },
            async (args, _extra): Promise<{
                content: { type: "text"; text: string }[];
                isError?: boolean;
            }> => {
                const result = await this.toolHandlers.handleGetIndexingStatus(args);

                // Wrapper: force the type of `type` to be "text" literal
                const wrappedContent = result.content.map(item => ({
                    ...item,
                    type: "text" as const,
                }));

                return {
                    ...result,
                    content: wrappedContent,
                };
            }
        );
    }

    public getMcpServer() {
        return this.server;
    }
}

async function main() {
    const config = createMcpConfig();
    logConfigurationSummary(config);

    const mcpServer = new ContextMcpHttpServer(config);
    const app = express();
    app.use(express.json());

    // --- JSON HTTP endpoint ---
    app.post("/mcp", async (req, res) => {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });

        res.on("close", () => transport.close());

        await mcpServer.getMcpServer().connect(transport);
        await transport.handleRequest(req, res, req.body);
    });

    // --- SSE endpoint for streaming connections ---
    app.get("/mcp/sse", async (req, res) => {
        const transport = new SSEServerTransport("/sse", res);
        await mcpServer.getMcpServer().connect(transport);
        console.log("🌐 SSE client connected");
    });

    // --- Start server ---
    const port = Number(process.env.PORT || 3000);
    app
        .listen(port, () => {
            console.log(`🚀 MCP Server running on:`);
            console.log(`   • HTTP  : http://localhost:${port}/mcp`);
            console.log(`   • SSE   : http://localhost:${port}/mcp/sse`);
        })
        .on("error", (err) => {
            console.error("[FATAL] Server error:", err);
            process.exit(1);
        });
}

main().catch((err) => {
    console.error("[HTTP] Fatal error:", err);
    process.exit(1);
});