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
import { CodeContext, SemanticSearchResult } from "@zilliz/code-context-core";
import { OpenAIEmbedding, VoyageAIEmbedding, GeminiEmbedding, OllamaEmbedding } from "@zilliz/code-context-core";
import { MilvusVectorDatabase, COLLECTION_LIMIT_MESSAGE } from "@zilliz/code-context-core";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { z } from "zod";
import * as crypto from "crypto";

// Helper function to get default model for each provider
function getDefaultModelForProvider(provider: string): string {
    switch (provider) {
        case 'OpenAI':
            return 'text-embedding-3-small';
        case 'VoyageAI':
            return 'voyage-code-3';
        case 'Gemini':
            return 'gemini-embedding-001';
        case 'Ollama':
            return 'nomic-embed-text';
        default:
            return 'text-embedding-3-small';
    }
}

// Helper function to get embedding model with provider-specific environment variable priority
function getEmbeddingModelForProvider(provider: string): string {
    switch (provider) {
        case 'Ollama':
            // For Ollama, prioritize OLLAMA_MODEL over EMBEDDING_MODEL
            const ollamaModel = process.env.OLLAMA_MODEL || process.env.EMBEDDING_MODEL || getDefaultModelForProvider(provider);
            console.log(`[DEBUG] 🎯 Ollama model selection: OLLAMA_MODEL=${process.env.OLLAMA_MODEL || 'NOT SET'}, EMBEDDING_MODEL=${process.env.EMBEDDING_MODEL || 'NOT SET'}, selected=${ollamaModel}`);
            return ollamaModel;
        case 'OpenAI':
        case 'VoyageAI':
        case 'Gemini':
        default:
            // For other providers, use EMBEDDING_MODEL or default
            return process.env.EMBEDDING_MODEL || getDefaultModelForProvider(provider);
    }
}

// Helper function to create embedding instance based on provider
function createEmbeddingInstance(config: CodeContextMcpConfig): OpenAIEmbedding | VoyageAIEmbedding | GeminiEmbedding | OllamaEmbedding {
    console.log(`[EMBEDDING] Creating ${config.embeddingProvider} embedding instance...`);

    switch (config.embeddingProvider) {
        case 'OpenAI':
            if (!config.openaiApiKey) {
                console.error(`[EMBEDDING] ❌ OpenAI API key is required but not provided`);
                throw new Error('OPENAI_API_KEY is required for OpenAI embedding provider');
            }
            console.log(`[EMBEDDING] 🔧 Configuring OpenAI with model: ${config.embeddingModel}`);
            const openaiEmbedding = new OpenAIEmbedding({
                apiKey: config.openaiApiKey,
                model: config.embeddingModel,
                ...(config.openaiBaseUrl && { baseURL: config.openaiBaseUrl })
            });
            console.log(`[EMBEDDING] ✅ OpenAI embedding instance created successfully`);
            return openaiEmbedding;

        case 'VoyageAI':
            if (!config.voyageaiApiKey) {
                console.error(`[EMBEDDING] ❌ VoyageAI API key is required but not provided`);
                throw new Error('VOYAGEAI_API_KEY is required for VoyageAI embedding provider');
            }
            console.log(`[EMBEDDING] 🔧 Configuring VoyageAI with model: ${config.embeddingModel}`);
            const voyageEmbedding = new VoyageAIEmbedding({
                apiKey: config.voyageaiApiKey,
                model: config.embeddingModel
            });
            console.log(`[EMBEDDING] ✅ VoyageAI embedding instance created successfully`);
            return voyageEmbedding;

        case 'Gemini':
            if (!config.geminiApiKey) {
                console.error(`[EMBEDDING] ❌ Gemini API key is required but not provided`);
                throw new Error('GEMINI_API_KEY is required for Gemini embedding provider');
            }
            console.log(`[EMBEDDING] 🔧 Configuring Gemini with model: ${config.embeddingModel}`);
            const geminiEmbedding = new GeminiEmbedding({
                apiKey: config.geminiApiKey,
                model: config.embeddingModel
            });
            console.log(`[EMBEDDING] ✅ Gemini embedding instance created successfully`);
            return geminiEmbedding;

        case 'Ollama':
            const ollamaHost = config.ollamaHost || 'http://127.0.0.1:11434';
            console.log(`[EMBEDDING] 🔧 Configuring Ollama with model: ${config.embeddingModel}, host: ${ollamaHost}`);
            const ollamaEmbedding = new OllamaEmbedding({
                model: config.embeddingModel,
                host: config.ollamaHost
            });
            console.log(`[EMBEDDING] ✅ Ollama embedding instance created successfully`);
            return ollamaEmbedding;

        default:
            console.error(`[EMBEDDING] ❌ Unsupported embedding provider: ${config.embeddingProvider}`);
            throw new Error(`Unsupported embedding provider: ${config.embeddingProvider}`);
    }
}

interface CodeContextMcpConfig {
    name: string;
    version: string;
    // Embedding provider configuration
    embeddingProvider: 'OpenAI' | 'VoyageAI' | 'Gemini' | 'Ollama';
    embeddingModel: string;
    // Provider-specific API keys
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    voyageaiApiKey?: string;
    geminiApiKey?: string;
    // Ollama configuration
    ollamaModel?: string;
    ollamaHost?: string;
    // Vector database configuration
    milvusAddress: string;
    milvusToken?: string;
}

interface CodebaseSnapshot {
    indexedCodebases: string[];
    indexingCodebases: string[];  // List of codebases currently being indexed
    lastUpdated: string;
}

class CodeContextMcpServer {
    private server: Server;
    private codeContext: CodeContext;
    private activeCodebasePath: string | null = null;
    private indexedCodebases: string[] = [];
    private indexingCodebases: string[] = [];  // List of codebases currently being indexed
    private indexingStats: { indexedFiles: number; totalChunks: number } | null = null;
    private isSyncing: boolean = false;
    private snapshotFilePath: string;
    private currentWorkspace: string;

    constructor(config: CodeContextMcpConfig) {
        // Get current workspace
        this.currentWorkspace = process.cwd();
        console.log(`[WORKSPACE] Current workspace: ${this.currentWorkspace}`);

        // Initialize snapshot file path
        this.snapshotFilePath = path.join(os.homedir(), '.code-context-mcp', 'codebase-snapshot.json');

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

        // Initialize code context with proper configuration
        console.log(`[EMBEDDING] Initializing embedding provider: ${config.embeddingProvider}`);
        console.log(`[EMBEDDING] Using model: ${config.embeddingModel}`);

        const embedding = createEmbeddingInstance(config);

        console.log(`[EMBEDDING] ✅ Successfully initialized ${config.embeddingProvider} embedding provider`);
        console.log(`[EMBEDDING] Provider details - Model: ${config.embeddingModel}, Dimension: ${embedding.getDimension()}`);

        // Log provider-specific configuration details
        switch (config.embeddingProvider) {
            case 'OpenAI':
                console.log(`[EMBEDDING] OpenAI configuration - API Key: ${config.openaiApiKey ? '✅ Provided' : '❌ Missing'}, Base URL: ${config.openaiBaseUrl || 'Default'}`);
                break;
            case 'VoyageAI':
                console.log(`[EMBEDDING] VoyageAI configuration - API Key: ${config.voyageaiApiKey ? '✅ Provided' : '❌ Missing'}`);
                break;
            case 'Gemini':
                console.log(`[EMBEDDING] Gemini configuration - API Key: ${config.geminiApiKey ? '✅ Provided' : '❌ Missing'}`);
                break;
            case 'Ollama':
                console.log(`[EMBEDDING] Ollama configuration - Host: ${config.ollamaHost || 'http://127.0.0.1:11434'}, Model: ${config.embeddingModel}`);
                break;
        }

        const vectorDatabase = new MilvusVectorDatabase({
            address: config.milvusAddress,
            ...(config.milvusToken && { token: config.milvusToken })
        });

        this.codeContext = new CodeContext({
            embedding,
            vectorDatabase
        });

        // Load existing codebase snapshot on startup
        this.loadCodebaseSnapshot();

        this.setupTools();
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

            // Handle indexing codebases - treat them as not indexed since they were interrupted
            const validIndexingCodebases: string[] = [];
            for (const codebasePath of snapshot.indexingCodebases || []) {
                if (fs.existsSync(codebasePath)) {
                    console.warn(`[SNAPSHOT-DEBUG] Found interrupted indexing codebase: ${codebasePath}. Treating as not indexed.`);
                    // Don't add to validIndexingCodebases - treat as not indexed
                } else {
                    console.warn(`[SNAPSHOT-DEBUG] Interrupted indexing codebase no longer exists: ${codebasePath}`);
                }
            }

            // Restore state - only fully indexed codebases
            this.indexedCodebases = validCodebases;
            this.indexingCodebases = []; // Reset indexing codebases since they were interrupted

            console.log(`[SNAPSHOT-DEBUG] Restored ${validCodebases.length} fully indexed codebases.`);
            console.log(`[SNAPSHOT-DEBUG] Reset ${snapshot.indexingCodebases?.length || 0} interrupted indexing codebases.`);

            // Save updated snapshot if we removed any invalid paths or reset indexing codebases
            if (validCodebases.length !== snapshot.indexedCodebases.length ||
                (snapshot.indexingCodebases && snapshot.indexingCodebases.length > 0)) {
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
                indexingCodebases: this.indexingCodebases,
                lastUpdated: new Date().toISOString()
            };

            fs.writeFileSync(this.snapshotFilePath, JSON.stringify(snapshot, null, 2));
            console.log('[SNAPSHOT-DEBUG] Snapshot saved successfully. Indexed codebases:', this.indexedCodebases.length, 'Indexing codebases:', this.indexingCodebases.length);

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
                        description: "Search the indexed codebase using natural language queries within specified path. If the codebase is currently being indexed, you should inform the user that the search results may be incomplete or inaccurate until indexing completes.",
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
                    },

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

            // Check if already indexing
            if (this.indexingCodebases.includes(absolutePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Codebase '${absolutePath}' is already being indexed in the background. Please wait for completion.`
                    }],
                    isError: true
                };
            }

            // Check if already indexed (unless force is true)
            if (!forceReindex && this.indexedCodebases.includes(absolutePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Codebase '${absolutePath}' is already indexed. Use force=true to re-index.`
                    }],
                    isError: true
                };
            }

            // CRITICAL: Pre-index collection creation validation
            try {
                const normalizedPath = path.resolve(absolutePath);
                const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
                const collectionName = `code_chunks_${hash.substring(0, 8)}`;

                console.log(`[INDEX-VALIDATION] 🔍 Validating collection creation for: ${collectionName}`);

                // Get embedding dimension for collection creation
                const embeddingProvider = this.codeContext['embedding'];
                const dimension = embeddingProvider.getDimension();

                // Attempt to create collection - this will throw COLLECTION_LIMIT_MESSAGE if limit reached
                await this.codeContext['vectorDatabase'].createCollection(
                    collectionName,
                    dimension,
                    `Code context collection: ${collectionName}`
                );

                // If creation succeeds, immediately drop the test collection
                await this.codeContext['vectorDatabase'].dropCollection(collectionName);
                console.log(`[INDEX-VALIDATION] ✅ Collection creation validated successfully`);

            } catch (validationError: any) {
                const errorMessage = typeof validationError === 'string' ? validationError :
                    (validationError instanceof Error ? validationError.message : String(validationError));

                if (errorMessage === COLLECTION_LIMIT_MESSAGE || errorMessage.includes(COLLECTION_LIMIT_MESSAGE)) {
                    console.error(`[INDEX-VALIDATION] ❌ Collection limit validation failed: ${absolutePath}`);

                    // CRITICAL: Immediately return the COLLECTION_LIMIT_MESSAGE to MCP client
                    return {
                        content: [{
                            type: "text",
                            text: COLLECTION_LIMIT_MESSAGE
                        }],
                        isError: true
                    };
                } else {
                    // Handle other collection creation errors
                    console.error(`[INDEX-VALIDATION] ❌ Collection creation validation failed:`, validationError);
                    return {
                        content: [{
                            type: "text",
                            text: `Error validating collection creation: ${validationError.message || validationError}`
                        }],
                        isError: true
                    };
                }
            }

            // Add to indexing list and save snapshot immediately
            this.indexingCodebases.push(absolutePath);
            this.saveCodebaseSnapshot();

            // Track the codebase path for syncing
            this.trackCodebasePath(absolutePath);

            // Start background indexing - now safe to proceed
            this.startBackgroundIndexing(absolutePath, forceReindex, splitterType);

            const pathInfo = codebasePath !== absolutePath
                ? `\nNote: Input path '${codebasePath}' was resolved to absolute path '${absolutePath}'`
                : '';

            return {
                content: [{
                    type: "text",
                    text: `Started background indexing for codebase '${absolutePath}' using ${splitterType.toUpperCase()} splitter.${pathInfo}\n\nIndexing is running in the background. You can search the codebase while indexing is in progress, but results may be incomplete until indexing completes.`
                }]
            };

        } catch (error: any) {
            // Enhanced error handling to prevent MCP service crash
            console.error('Error in handleIndexCodebase:', error);

            // Ensure we always return a proper MCP response, never throw
            return {
                content: [{
                    type: "text",
                    text: `Error starting indexing: ${error.message || error}`
                }],
                isError: true
            };
        }
    }

    private async startBackgroundIndexing(codebasePath: string, forceReindex: boolean, splitterType: string) {
        const absolutePath = codebasePath;

        try {
            console.log(`[BACKGROUND-INDEX] Starting background indexing for: ${absolutePath}`);

            // Clear index if force is true
            if (forceReindex) {
                console.log(`[BACKGROUND-INDEX] Clearing existing index for: ${absolutePath}`);
                await this.codeContext.clearIndex(absolutePath);
            }

            // Use the existing CodeContext instance for indexing.
            let contextForThisTask = this.codeContext;
            if (splitterType !== 'ast') {
                console.warn(`[BACKGROUND-INDEX] Non-AST splitter '${splitterType}' requested; falling back to AST splitter`);
            }

            // Generate collection name
            const normalizedPath = path.resolve(absolutePath);
            const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
            const collectionName = `code_chunks_${hash.substring(0, 8)}`;

            // Initialize file synchronizer with proper ignore patterns
            const { FileSynchronizer } = await import("@zilliz/code-context-core");
            const ignorePatterns = this.codeContext['ignorePatterns'] || [];
            console.log(`[BACKGROUND-INDEX] Using ignore patterns: ${ignorePatterns.join(', ')}`);
            const synchronizer = new FileSynchronizer(absolutePath, ignorePatterns);
            await synchronizer.initialize();

            // Store synchronizer in the context's internal map
            this.codeContext['synchronizers'].set(collectionName, synchronizer);
            if (contextForThisTask !== this.codeContext) {
                contextForThisTask['synchronizers'].set(collectionName, synchronizer);
            }

            console.log(`[BACKGROUND-INDEX] Starting indexing with ${splitterType} splitter for: ${absolutePath}`);

            // Log embedding provider information before indexing
            const embeddingProvider = this.codeContext['embedding'];
            console.log(`[BACKGROUND-INDEX] 🧠 Using embedding provider: ${embeddingProvider.getProvider()} with dimension: ${embeddingProvider.getDimension()}`);

            // Start indexing with the appropriate context
            console.log(`[BACKGROUND-INDEX] 🚀 Beginning codebase indexing process...`);
            const stats = await contextForThisTask.indexCodebase(absolutePath);
            console.log(`[BACKGROUND-INDEX] ✅ Indexing completed successfully! Files: ${stats.indexedFiles}, Chunks: ${stats.totalChunks}`);

            // Move from indexing to indexed list
            this.indexingCodebases = this.indexingCodebases.filter(path => path !== absolutePath);
            if (!this.indexedCodebases.includes(absolutePath)) {
                this.indexedCodebases.push(absolutePath);
            }
            this.indexingStats = { indexedFiles: stats.indexedFiles, totalChunks: stats.totalChunks };

            // Save snapshot after updating codebase lists
            this.saveCodebaseSnapshot();

            let message = `Background indexing completed for '${absolutePath}' using ${splitterType.toUpperCase()} splitter.\nIndexed ${stats.indexedFiles} files, ${stats.totalChunks} chunks.`;
            if (stats.status === 'limit_reached') {
                message += `\n⚠️  Warning: Indexing stopped because the chunk limit (450,000) was reached. The index may be incomplete.`;
            }

            console.log(`[BACKGROUND-INDEX] ${message}`);

        } catch (error: any) {
            console.error(`[BACKGROUND-INDEX] Error during indexing for ${absolutePath}:`, error);
            // Remove from indexing list on error
            this.indexingCodebases = this.indexingCodebases.filter(path => path !== absolutePath);
            this.saveCodebaseSnapshot();

            // Log error but don't crash MCP service - indexing errors are handled gracefully
            console.error(`[BACKGROUND-INDEX] Indexing failed for ${absolutePath}: ${error.message || error}`);
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
                    console.log(`[SYNC-DEBUG] Calling codeContext.reindexByChange() for '${codebasePath}'`);
                    const stats = await this.codeContext.reindexByChange(codebasePath);
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

            // Track the codebase path for syncing (even if not indexed yet)
            this.trackCodebasePath(absolutePath);

            // Check if this codebase is indexed or being indexed
            const isIndexed = this.indexedCodebases.includes(absolutePath);
            const isIndexing = this.indexingCodebases.includes(absolutePath);

            if (!isIndexed && !isIndexing) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Codebase '${absolutePath}' is not indexed. Please index it first using the index_codebase tool.`
                    }],
                    isError: true
                };
            }

            // Show indexing status if codebase is being indexed
            let indexingStatusMessage = '';
            if (isIndexing) {
                indexingStatusMessage = `\n⚠️  **Indexing in Progress**: This codebase is currently being indexed in the background. Search results may be incomplete until indexing completes.`;
            }

            console.log(`[SEARCH] Searching in codebase: ${absolutePath}`);
            console.log(`[SEARCH] Query: "${query}"`);
            console.log(`[SEARCH] Indexing status: ${isIndexing ? 'In Progress' : 'Completed'}`);

            // Log embedding provider information before search
            const embeddingProvider = this.codeContext['embedding'];
            console.log(`[SEARCH] 🧠 Using embedding provider: ${embeddingProvider.getProvider()} for semantic search`);
            console.log(`[SEARCH] 🔍 Generating embeddings for query using ${embeddingProvider.getProvider()}...`);

            // Search in the specified codebase
            const searchResults = await this.codeContext.semanticSearch(
                absolutePath,
                query,
                Math.min(resultLimit, 50),
                0.3
            );

            console.log(`[SEARCH] ✅ Search completed! Found ${searchResults.length} results using ${embeddingProvider.getProvider()} embeddings`);

            if (searchResults.length === 0) {
                let noResultsMessage = `No results found for query: "${query}" in codebase '${absolutePath}'`;
                if (isIndexing) {
                    noResultsMessage += `\n\nNote: This codebase is still being indexed. Try searching again after indexing completes, or the query may not match any indexed content.`;
                }
                return {
                    content: [{
                        type: "text",
                        text: noResultsMessage
                    }]
                };
            }

            // Format results
            const formattedResults = searchResults.map((result: any, index: number) => {
                const location = `${result.relativePath}:${result.startLine}-${result.endLine}`;
                const context = this.truncateContent(result.content, 5000);
                const codebaseInfo = path.basename(absolutePath);

                return `${index + 1}. Code snippet (${result.language}) [${codebaseInfo}]\n` +
                    `   Location: ${location}\n` +
                    `   Score: ${result.score.toFixed(3)}\n` +
                    `   Context: \n\`\`\`${result.language}\n${context}\n\`\`\`\n`;
            }).join('\n');

            let resultMessage = `Found ${searchResults.length} results for query: "${query}" in codebase '${absolutePath}'${indexingStatusMessage}\n\n${formattedResults}`;

            if (isIndexing) {
                resultMessage += `\n\n💡 **Tip**: This codebase is still being indexed. More results may become available as indexing progresses.`;
            }

            return {
                content: [{
                    type: "text",
                    text: resultMessage
                }]
            };
        } catch (error) {
            // Check if this is the collection limit error
            // Handle both direct string throws and Error objects containing the message
            const errorMessage = typeof error === 'string' ? error : (error instanceof Error ? error.message : String(error));

            if (errorMessage === COLLECTION_LIMIT_MESSAGE || errorMessage.includes(COLLECTION_LIMIT_MESSAGE)) {
                // Return the collection limit message as a successful response
                // This ensures LLM treats it as final answer, not as retryable error
                return {
                    content: [{
                        type: "text",
                        text: COLLECTION_LIMIT_MESSAGE
                    }]
                };
            }

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

        if (this.indexedCodebases.length === 0 && this.indexingCodebases.length === 0) {
            return {
                content: [{
                    type: "text",
                    text: "No codebases are currently indexed or being indexed."
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

            // Check if this codebase is indexed or being indexed
            const isIndexed = this.indexedCodebases.includes(absolutePath);
            const isIndexing = this.indexingCodebases.includes(absolutePath);

            if (!isIndexed && !isIndexing) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Codebase '${absolutePath}' is not indexed or being indexed.`
                    }],
                    isError: true
                };
            }

            console.log(`[CLEAR] Clearing codebase: ${absolutePath}`);

            try {
                await this.codeContext.clearIndex(absolutePath);
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

            // Remove the cleared codebase from both lists
            this.indexedCodebases = this.indexedCodebases.filter(codebasePath =>
                codebasePath !== absolutePath
            );
            this.indexingCodebases = this.indexingCodebases.filter(codebasePath =>
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

            if (this.indexedCodebases.length > 0 || this.indexingCodebases.length > 0) {
                resultText += `\n${this.indexedCodebases.length} other indexed codebase(s) and ${this.indexingCodebases.length} indexing codebase(s) remain`;
            }

            return {
                content: [{
                    type: "text",
                    text: resultText
                }]
            };
        } catch (error) {
            // Check if this is the collection limit error
            // Handle both direct string throws and Error objects containing the message
            const errorMessage = typeof error === 'string' ? error : (error instanceof Error ? error.message : String(error));

            if (errorMessage === COLLECTION_LIMIT_MESSAGE || errorMessage.includes(COLLECTION_LIMIT_MESSAGE)) {
                // Return the collection limit message as a successful response
                // This ensures LLM treats it as final answer, not as retryable error
                return {
                    content: [{
                        type: "text",
                        text: COLLECTION_LIMIT_MESSAGE
                    }]
                };
            }

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
        console.log('Starting CodeContext MCP server...');

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

    private trackCodebasePath(codebasePath: string) {
        const absolutePath = this.ensureAbsolutePath(codebasePath);
        if (!this.indexedCodebases.includes(absolutePath)) {
            this.indexedCodebases.push(absolutePath);
            this.saveCodebaseSnapshot();
            console.log(`[TRACKING] Added codebase path to indexedCodebases: ${absolutePath}`);
        }
    }
}

// Main execution
async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);

    const embeddingProvider = (process.env.EMBEDDING_PROVIDER?.toLowerCase() === 'ollama' ? 'ollama' : 'openai') as 'openai' | 'ollama';
    // Debug: Print all environment variables related to CodeContext
    console.log(`[DEBUG] 🔍 Environment Variables Debug:`);
    console.log(`[DEBUG]   EMBEDDING_PROVIDER: ${process.env.EMBEDDING_PROVIDER || 'NOT SET'}`);
    console.log(`[DEBUG]   EMBEDDING_MODEL: ${process.env.EMBEDDING_MODEL || 'NOT SET'}`);
    console.log(`[DEBUG]   OLLAMA_MODEL: ${process.env.OLLAMA_MODEL || 'NOT SET'}`);
    console.log(`[DEBUG]   GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'SET (length: ' + process.env.GEMINI_API_KEY.length + ')' : 'NOT SET'}`);
    console.log(`[DEBUG]   OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'SET (length: ' + process.env.OPENAI_API_KEY.length + ')' : 'NOT SET'}`);
    console.log(`[DEBUG]   MILVUS_ADDRESS: ${process.env.MILVUS_ADDRESS || 'NOT SET'}`);
    console.log(`[DEBUG]   NODE_ENV: ${process.env.NODE_ENV || 'NOT SET'}`);

    const config: CodeContextMcpConfig = {
        name: process.env.MCP_SERVER_NAME || "CodeContext MCP Server",
        version: process.env.MCP_SERVER_VERSION || "1.0.0",
        // Embedding provider configuration
        embeddingProvider: (process.env.EMBEDDING_PROVIDER as 'OpenAI' | 'VoyageAI' | 'Gemini' | 'Ollama') || 'OpenAI',
        embeddingModel: getEmbeddingModelForProvider(process.env.EMBEDDING_PROVIDER || 'OpenAI'),
        // Provider-specific API keys
        openaiApiKey: process.env.OPENAI_API_KEY,
        openaiBaseUrl: process.env.OPENAI_BASE_URL,
        voyageaiApiKey: process.env.VOYAGEAI_API_KEY,
        geminiApiKey: process.env.GEMINI_API_KEY,
        // Ollama configuration
        ollamaModel: process.env.OLLAMA_MODEL,
        ollamaHost: process.env.OLLAMA_HOST,
        // Vector database configuration
        milvusAddress: process.env.MILVUS_ADDRESS || "localhost:19530",
        milvusToken: process.env.MILVUS_TOKEN
    };

    // Show help if requested
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
CodeContext MCP Server

Usage: npx @zilliz/code-context-mcp@latest [options]

Options:
  --help, -h                          Show this help message

Environment Variables:
  MCP_SERVER_NAME         Server name
  MCP_SERVER_VERSION      Server version
  
  Embedding Provider Configuration:
  EMBEDDING_PROVIDER      Embedding provider: OpenAI, VoyageAI, Gemini, Ollama (default: OpenAI)
  EMBEDDING_MODEL         Embedding model name (auto-detected if not specified)
  
  Provider-specific API Keys:
  OPENAI_API_KEY          OpenAI API key (required for OpenAI provider)
  OPENAI_BASE_URL         OpenAI API base URL (optional, for custom endpoints)
  VOYAGEAI_API_KEY        VoyageAI API key (required for VoyageAI provider)
  GEMINI_API_KEY          Google AI API key (required for Gemini provider)
  
  Ollama Configuration:
  OLLAMA_HOST             Ollama server host (default: http://127.0.0.1:11434)
  OLLAMA_MODEL            Ollama model name (default: nomic-embed-text)
  
  Vector Database Configuration:
  MILVUS_ADDRESS          Milvus address (default: localhost:19530)
  MILVUS_TOKEN            Milvus token (optional)

Examples:
  # Start MCP server with OpenAI (default)
  OPENAI_API_KEY=sk-xxx npx @zilliz/code-context-mcp@latest
  
  # Start MCP server with VoyageAI
  EMBEDDING_PROVIDER=VoyageAI VOYAGEAI_API_KEY=pa-xxx npx @zilliz/code-context-mcp@latest
  
  # Start MCP server with Gemini
  EMBEDDING_PROVIDER=Gemini GEMINI_API_KEY=xxx npx @zilliz/code-context-mcp@latest
  
  # Start MCP server with Ollama
  EMBEDDING_PROVIDER=Ollama EMBEDDING_MODEL=nomic-embed-text npx @zilliz/code-context-mcp@latest
        `);
        process.exit(0);
    }

    // Log configuration summary before starting server
    console.log(`[MCP] 🚀 Starting CodeContext MCP Server`);
    console.log(`[MCP] Configuration Summary:`);
    console.log(`[MCP]   Server: ${config.name} v${config.version}`);
    console.log(`[MCP]   Embedding Provider: ${config.embeddingProvider}`);
    console.log(`[MCP]   Embedding Model: ${config.embeddingModel}`);
    console.log(`[MCP]   Milvus Address: ${config.milvusAddress}`);

    // Log provider-specific configuration without exposing sensitive data
    switch (config.embeddingProvider) {
        case 'OpenAI':
            console.log(`[MCP]   OpenAI API Key: ${config.openaiApiKey ? '✅ Configured' : '❌ Missing'}`);
            if (config.openaiBaseUrl) {
                console.log(`[MCP]   OpenAI Base URL: ${config.openaiBaseUrl}`);
            }
            break;
        case 'VoyageAI':
            console.log(`[MCP]   VoyageAI API Key: ${config.voyageaiApiKey ? '✅ Configured' : '❌ Missing'}`);
            break;
        case 'Gemini':
            console.log(`[MCP]   Gemini API Key: ${config.geminiApiKey ? '✅ Configured' : '❌ Missing'}`);
            break;
        case 'Ollama':
            console.log(`[MCP]   Ollama Host: ${config.ollamaHost || 'http://127.0.0.1:11434'}`);
            console.log(`[MCP]   Ollama Model: ${config.embeddingModel}`);
            break;
    }

    console.log(`[MCP] 🔧 Initializing server components...`);

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