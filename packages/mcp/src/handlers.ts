import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Context, COLLECTION_LIMIT_MESSAGE } from "@zilliz/claude-context-core";
import { SnapshotManager } from "./snapshot.js";
import { ensureAbsolutePath, truncateContent, trackCodebasePath } from "./utils.js";

export class ToolHandlers {
    private context: Context;
    private snapshotManager: SnapshotManager;
    private indexingStats: { indexedFiles: number; totalChunks: number } | null = null;
    private currentWorkspace: string;

    constructor(context: Context, snapshotManager: SnapshotManager) {
        this.context = context;
        this.snapshotManager = snapshotManager;
        this.currentWorkspace = process.cwd();
        console.log(`[WORKSPACE] Current workspace: ${this.currentWorkspace}`);
    }

    /**
     * Best-effort cloud sync for diagnostics.
     *
     * IMPORTANT SAFETY RULE:
     * Never remove local snapshot entries based only on cloud list/query results.
     * Different CLI sessions may run with different credentials/clusters, and
     * transient cloud visibility issues can cause false negatives.
     */
    private async syncIndexedCodebasesFromCloud(): Promise<void> {
        try {
            console.log(`[SYNC-CLOUD] 🔄 Syncing indexed codebases from Zilliz Cloud...`);

            // Get all collections using the interface method
            const vectorDb = this.context.getVectorDatabase();

            // Use the new listCollections method from the interface
            const collections = await vectorDb.listCollections();

            console.log(`[SYNC-CLOUD] 📋 Found ${collections.length} collections in Zilliz Cloud`);

            if (collections.length === 0) {
                console.warn(`[SYNC-CLOUD] ⚠️  Cloud returned zero collections. Skipping local snapshot cleanup to avoid false negatives.`);
                return;
            }

            const cloudCodebases = new Set<string>();

            // Check each collection for codebase path
            for (const collectionName of collections) {
                try {
                    // Skip collections that don't match the code_chunks pattern (support both legacy and new collections)
                    if (!collectionName.startsWith('code_chunks_') && !collectionName.startsWith('hybrid_code_chunks_')) {
                        console.log(`[SYNC-CLOUD] ⏭️  Skipping non-code collection: ${collectionName}`);
                        continue;
                    }

                    console.log(`[SYNC-CLOUD] 🔍 Checking collection: ${collectionName}`);

                    // Query the first document to get metadata
                    const results = await vectorDb.query(
                        collectionName,
                        '', // Empty filter to get all results
                        ['metadata'], // Only fetch metadata field
                        1 // Only need one result to extract codebasePath
                    );

                    if (results && results.length > 0) {
                        const firstResult = results[0];
                        const metadataStr = firstResult.metadata;

                        if (metadataStr) {
                            try {
                                const metadata = JSON.parse(metadataStr);
                                const codebasePath = metadata.codebasePath;

                                if (codebasePath && typeof codebasePath === 'string') {
                                    console.log(`[SYNC-CLOUD] 📍 Found codebase path: ${codebasePath} in collection: ${collectionName}`);
                                    cloudCodebases.add(codebasePath);
                                } else {
                                    console.warn(`[SYNC-CLOUD] ⚠️  No codebasePath found in metadata for collection: ${collectionName}`);
                                }
                            } catch (parseError) {
                                console.warn(`[SYNC-CLOUD] ⚠️  Failed to parse metadata JSON for collection ${collectionName}:`, parseError);
                            }
                        } else {
                            console.warn(`[SYNC-CLOUD] ⚠️  No metadata found in collection: ${collectionName}`);
                        }
                    } else {
                        console.log(`[SYNC-CLOUD] ℹ️  Collection ${collectionName} is empty`);
                    }
                } catch (collectionError: any) {
                    console.warn(`[SYNC-CLOUD] ⚠️  Error checking collection ${collectionName}:`, collectionError.message || collectionError);
                    // Continue with next collection
                }
            }

            console.log(`[SYNC-CLOUD] 📊 Found ${cloudCodebases.size} valid codebases in cloud`);

            // Get current local codebases
            const localCodebases = this.snapshotManager.getIndexedCodebases();
            console.log(`[SYNC-CLOUD] 📊 Found ${localCodebases.length} local codebases in snapshot`);

            const missingInCloud = localCodebases.filter((localCodebase) => !cloudCodebases.has(localCodebase));
            if (missingInCloud.length > 0) {
                console.warn(
                    `[SYNC-CLOUD] ⚠️  ${missingInCloud.length} local codebase(s) were not found in cloud metadata. ` +
                    `Keeping local snapshot unchanged for safety.`
                );
            }

            // Note: intentionally no snapshot mutation here.
            console.log(`[SYNC-CLOUD] ℹ️  Cloud sync is non-destructive; local snapshot was not modified.`);
            console.log(`[SYNC-CLOUD] ✅ Cloud sync completed successfully`);
        } catch (error: any) {
            console.error(`[SYNC-CLOUD] ❌ Error syncing codebases from cloud:`, error.message || error);
            // Don't throw - this is not critical for the main functionality
        }
    }

    public async handleIndexCodebase(args: any) {
        const { path: codebasePath, force, splitter, customExtensions, ignorePatterns } = args;
        const forceReindex = force || false;
        const splitterType = splitter || 'ast'; // Default to AST
        const customFileExtensions = customExtensions || [];
        const customIgnorePatterns = ignorePatterns || [];

        try {
            // Sync indexed codebases from cloud first
            await this.syncIndexedCodebasesFromCloud();

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
            const absolutePath = ensureAbsolutePath(codebasePath);

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
            if (this.snapshotManager.getIndexingCodebases().includes(absolutePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Codebase '${absolutePath}' is already being indexed in the background. Please wait for completion.`
                    }],
                    isError: true
                };
            }

            const snapshotHasIndex = this.snapshotManager.getIndexedCodebases().includes(absolutePath);
            const cloudHasIndex = await this.context.hasIndex(absolutePath);

            // Reconcile local snapshot with cloud truth for this specific codebase
            if (snapshotHasIndex !== cloudHasIndex) {
                console.warn(`[INDEX-VALIDATION] ❌ Snapshot and cloud index mismatch: ${absolutePath}`);
                if (cloudHasIndex && !snapshotHasIndex) {
                    this.snapshotManager.setCodebaseIndexed(absolutePath, {
                        indexedFiles: 0,
                        totalChunks: 0,
                        status: 'completed'
                    });
                    await this.snapshotManager.saveCodebaseSnapshot('index-reconcile-cloud-present');
                    console.log(`[INDEX-VALIDATION] 🛠️  Recovered missing snapshot entry from cloud index: ${absolutePath}`);
                } else if (!cloudHasIndex && snapshotHasIndex) {
                    this.snapshotManager.removeCodebaseCompletely(absolutePath);
                    await this.snapshotManager.saveCodebaseSnapshot('index-reconcile-cloud-missing');
                    console.log(`[INDEX-VALIDATION] 🧹 Removed stale snapshot entry without cloud index: ${absolutePath}`);
                }
            }

            // Check if already indexed in cloud (unless force is true)
            if (!forceReindex && cloudHasIndex) {
                return {
                    content: [{
                        type: "text",
                        text: `Codebase '${absolutePath}' is already indexed. Use force=true to re-index.`
                    }],
                    isError: true
                };
            }

            // If force reindex and codebase is already indexed, remove it
            if (forceReindex) {
                if (this.snapshotManager.getIndexedCodebases().includes(absolutePath)) {
                    console.log(`[FORCE-REINDEX] 🔄 Removing '${absolutePath}' from indexed list for re-indexing`);
                    this.snapshotManager.removeCodebaseCompletely(absolutePath);
                }
                if (cloudHasIndex) {
                    console.log(`[FORCE-REINDEX] 🔄 Clearing index for '${absolutePath}'`);
                    await this.context.clearIndex(absolutePath);
                }
            }

            // CRITICAL: Pre-index collection creation validation
            try {
                console.log(`[INDEX-VALIDATION] 🔍 Validating collection creation capability`);
                const canCreateCollection = await this.context.getVectorDatabase().checkCollectionLimit();

                if (!canCreateCollection) {
                    console.error(`[INDEX-VALIDATION] ❌ Collection limit validation failed: ${absolutePath}`);

                    // CRITICAL: Immediately return the COLLECTION_LIMIT_MESSAGE to MCP client
                    return {
                        content: [{
                            type: "text",
                            text: COLLECTION_LIMIT_MESSAGE
                        }],
                        isError: true
                    };
                }

                console.log(`[INDEX-VALIDATION] ✅  Collection creation validation completed`);
            } catch (validationError: any) {
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

            // Add custom extensions if provided
            if (customFileExtensions.length > 0) {
                console.log(`[CUSTOM-EXTENSIONS] Adding ${customFileExtensions.length} custom extensions: ${customFileExtensions.join(', ')}`);
                this.context.addCustomExtensions(customFileExtensions);
            }

            // Add custom ignore patterns if provided (before loading file-based patterns)
            if (customIgnorePatterns.length > 0) {
                console.log(`[IGNORE-PATTERNS] Adding ${customIgnorePatterns.length} custom ignore patterns: ${customIgnorePatterns.join(', ')}`);
                this.context.addCustomIgnorePatterns(customIgnorePatterns);
            }

            // Check current status and log if retrying after failure
            const currentStatus = this.snapshotManager.getCodebaseStatus(absolutePath);
            if (currentStatus === 'indexfailed') {
                const failedInfo = this.snapshotManager.getCodebaseInfo(absolutePath) as any;
                console.log(`[BACKGROUND-INDEX] Retrying indexing for previously failed codebase. Previous error: ${failedInfo?.errorMessage || 'Unknown error'}`);
            }

            // Set to indexing status and save snapshot immediately
            this.snapshotManager.setCodebaseIndexing(absolutePath, 0);
            await this.snapshotManager.saveCodebaseSnapshot('index-started');

            // Track the codebase path for syncing
            trackCodebasePath(absolutePath);

            // Start background indexing - now safe to proceed
            this.startBackgroundIndexing(absolutePath, forceReindex, splitterType);

            const pathInfo = codebasePath !== absolutePath
                ? `\nNote: Input path '${codebasePath}' was resolved to absolute path '${absolutePath}'`
                : '';

            const extensionInfo = customFileExtensions.length > 0
                ? `\nUsing ${customFileExtensions.length} custom extensions: ${customFileExtensions.join(', ')}`
                : '';

            const ignoreInfo = customIgnorePatterns.length > 0
                ? `\nUsing ${customIgnorePatterns.length} custom ignore patterns: ${customIgnorePatterns.join(', ')}`
                : '';

            return {
                content: [{
                    type: "text",
                    text: `Started background indexing for codebase '${absolutePath}' using ${splitterType.toUpperCase()} splitter.${pathInfo}${extensionInfo}${ignoreInfo}\n\nIndexing is running in the background. You can search the codebase while indexing is in progress, but results may be incomplete until indexing completes.`
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
        let lastPersistedProgress = -1;

        try {
            console.log(`[BACKGROUND-INDEX] Starting background indexing for: ${absolutePath}`);

            // Note: If force reindex, collection was already cleared during validation phase
            if (forceReindex) {
                console.log(`[BACKGROUND-INDEX] ℹ️  Force reindex mode - collection was already cleared during validation`);
            }

            // Use the existing Context instance for indexing.
            let contextForThisTask = this.context;
            if (splitterType !== 'ast') {
                console.warn(`[BACKGROUND-INDEX] Non-AST splitter '${splitterType}' requested; falling back to AST splitter`);
            }

            // Load ignore patterns from files first (including .ignore, .gitignore, etc.)
            await this.context.getLoadedIgnorePatterns(absolutePath);

            // Initialize file synchronizer with proper ignore patterns (including project-specific patterns)
            const { FileSynchronizer } = await import("@zilliz/claude-context-core");
            const ignorePatterns = this.context.getIgnorePatterns() || [];
            console.log(`[BACKGROUND-INDEX] Using ignore patterns: ${ignorePatterns.join(', ')}`);
            const synchronizer = new FileSynchronizer(absolutePath, ignorePatterns);
            await synchronizer.initialize();

            // Store synchronizer in the context (let context manage collection names)
            await this.context.getPreparedCollection(absolutePath);
            const collectionName = this.context.getCollectionName(absolutePath);
            this.context.setSynchronizer(collectionName, synchronizer);
            if (contextForThisTask !== this.context) {
                contextForThisTask.setSynchronizer(collectionName, synchronizer);
            }

            console.log(`[BACKGROUND-INDEX] Starting indexing with ${splitterType} splitter for: ${absolutePath}`);

            // Log embedding provider information before indexing
            const embeddingProvider = this.context.getEmbedding();
            console.log(`[BACKGROUND-INDEX] 🧠 Using embedding provider: ${embeddingProvider.getProvider()} with dimension: ${embeddingProvider.getDimension()}`);

            // Start indexing with the appropriate context and progress tracking
            console.log(`[BACKGROUND-INDEX] 🚀 Beginning codebase indexing process...`);
            const stats = await contextForThisTask.indexCodebase(absolutePath, (progress) => {
                // Update progress in snapshot manager using new method
                this.snapshotManager.setCodebaseIndexing(absolutePath, progress.percentage);

                // Coalesce disk writes: persist only meaningful progress jumps.
                const shouldPersistProgress =
                    lastPersistedProgress < 0 ||
                    progress.percentage >= 100 ||
                    Math.abs(progress.percentage - lastPersistedProgress) >= 2;

                if (shouldPersistProgress) {
                    this.snapshotManager.scheduleSaveCodebaseSnapshot('index-progress');
                    lastPersistedProgress = progress.percentage;
                    console.log(`[BACKGROUND-INDEX] 💾 Scheduled progress snapshot at ${progress.percentage.toFixed(1)}%`);
                }

                console.log(`[BACKGROUND-INDEX] Progress: ${progress.phase} - ${progress.percentage}% (${progress.current}/${progress.total})`);
            });
            console.log(`[BACKGROUND-INDEX] ✅ Indexing completed successfully! Files: ${stats.indexedFiles}, Chunks: ${stats.totalChunks}`);

            // Set codebase to indexed status with complete statistics
            this.snapshotManager.setCodebaseIndexed(absolutePath, stats);
            this.indexingStats = { indexedFiles: stats.indexedFiles, totalChunks: stats.totalChunks };

            // Save snapshot after updating codebase lists
            await this.snapshotManager.saveCodebaseSnapshot('index-completed');

            let message = `Background indexing completed for '${absolutePath}' using ${splitterType.toUpperCase()} splitter.\nIndexed ${stats.indexedFiles} files, ${stats.totalChunks} chunks.`;
            if (stats.status === 'limit_reached') {
                message += `\n⚠️  Warning: Indexing stopped because the chunk limit (450,000) was reached. The index may be incomplete.`;
            }

            console.log(`[BACKGROUND-INDEX] ${message}`);

        } catch (error: any) {
            console.error(`[BACKGROUND-INDEX] Error during indexing for ${absolutePath}:`, error);

            // Get the last attempted progress
            const lastProgress = this.snapshotManager.getIndexingProgress(absolutePath);

            // Set codebase to failed status with error information
            const errorMessage = error.message || String(error);
            this.snapshotManager.setCodebaseIndexFailed(absolutePath, errorMessage, lastProgress);
            await this.snapshotManager.saveCodebaseSnapshot('index-failed');

            // Log error but don't crash MCP service - indexing errors are handled gracefully
            console.error(`[BACKGROUND-INDEX] Indexing failed for ${absolutePath}: ${errorMessage}`);
        }
    }

    public async handleSearchCode(args: any) {
        const { path: codebasePath, query, limit = 10, extensionFilter } = args;
        const resultLimit = limit || 10;

        try {
            // Sync indexed codebases from cloud first
            await this.syncIndexedCodebasesFromCloud();

            // Force absolute path resolution - warn if relative path provided
            const absolutePath = ensureAbsolutePath(codebasePath);

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

            trackCodebasePath(absolutePath);

            // Check status with cloud as source of truth and snapshot as progress source
            const isIndexedInSnapshot = this.snapshotManager.getIndexedCodebases().includes(absolutePath);
            const isIndexing = this.snapshotManager.getIndexingCodebases().includes(absolutePath);
            const hasCloudIndex = await this.context.hasIndex(absolutePath);

            // Self-heal snapshot if index exists in cloud but local snapshot is missing
            if (hasCloudIndex && !isIndexedInSnapshot && !isIndexing) {
                this.snapshotManager.setCodebaseIndexed(absolutePath, {
                    indexedFiles: 0,
                    totalChunks: 0,
                    status: 'completed'
                });
                await this.snapshotManager.saveCodebaseSnapshot('search-reconcile-cloud-present');
                console.log(`[SEARCH] 🛠️ Restored missing snapshot entry from cloud index for: ${absolutePath}`);
            }

            if (!hasCloudIndex && !isIndexing) {
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
            console.log(`[SEARCH] Indexing status: ${isIndexing ? 'In Progress' : (hasCloudIndex ? 'Completed' : 'No collection yet')}`);

            // Log embedding provider information before search
            const embeddingProvider = this.context.getEmbedding();
            console.log(`[SEARCH] 🧠 Using embedding provider: ${embeddingProvider.getProvider()} for search`);
            console.log(`[SEARCH] 🔍 Generating embeddings for query using ${embeddingProvider.getProvider()}...`);

            // Build filter expression from extensionFilter list
            let filterExpr: string | undefined = undefined;
            if (Array.isArray(extensionFilter) && extensionFilter.length > 0) {
                const cleaned = extensionFilter
                    .filter((v: any) => typeof v === 'string')
                    .map((v: string) => v.trim())
                    .filter((v: string) => v.length > 0);
                const invalid = cleaned.filter((e: string) => !(e.startsWith('.') && e.length > 1 && !/\s/.test(e)));
                if (invalid.length > 0) {
                    return {
                        content: [{ type: 'text', text: `Error: Invalid file extensions in extensionFilter: ${JSON.stringify(invalid)}. Use proper extensions like '.ts', '.py'.` }],
                        isError: true
                    };
                }
                const quoted = cleaned.map((e: string) => `'${e}'`).join(', ');
                filterExpr = `fileExtension in [${quoted}]`;
            }

            // Search in the specified codebase
            const searchResults = await this.context.semanticSearch(
                absolutePath,
                query,
                Math.min(resultLimit, 50),
                0.3,
                filterExpr
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
                const context = truncateContent(result.content, 5000);
                const codebaseInfo = path.basename(absolutePath);

                return `${index + 1}. Code snippet (${result.language}) [${codebaseInfo}]\n` +
                    `   Location: ${location}\n` +
                    `   Rank: ${index + 1}\n` +
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
                    text: `Error searching code: ${errorMessage} Please check if the codebase has been indexed first.`
                }],
                isError: true
            };
        }
    }

    public async handleClearIndex(args: any) {
        const { path: codebasePath } = args;

        try {
            // Force absolute path resolution - warn if relative path provided
            const absolutePath = ensureAbsolutePath(codebasePath);

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
            const isIndexed = this.snapshotManager.getIndexedCodebases().includes(absolutePath);
            const isIndexing = this.snapshotManager.getIndexingCodebases().includes(absolutePath);
            const hasCloudIndex = await this.context.hasIndex(absolutePath);

            if (!isIndexed && !isIndexing && !hasCloudIndex) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Codebase '${absolutePath}' is not indexed or being indexed.`
                    }],
                    isError: true
                };
            }

            console.log(`[CLEAR] Clearing codebase: ${absolutePath}`);

            if (hasCloudIndex) {
                try {
                    await this.context.clearIndex(absolutePath);
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
            } else {
                console.log(`[CLEAR] ℹ️ No cloud collection found for ${absolutePath}, cleaning snapshot only`);
            }

            // Completely remove the cleared codebase from snapshot
            this.snapshotManager.removeCodebaseCompletely(absolutePath);

            // Reset indexing stats if this was the active codebase
            this.indexingStats = null;

            // Save snapshot after clearing index
            await this.snapshotManager.saveCodebaseSnapshot('clear-index');

            let resultText = `Successfully cleared codebase '${absolutePath}'`;

            const remainingIndexed = this.snapshotManager.getIndexedCodebases().length;
            const remainingIndexing = this.snapshotManager.getIndexingCodebases().length;

            if (remainingIndexed > 0 || remainingIndexing > 0) {
                resultText += `\n${remainingIndexed} other indexed codebase(s) and ${remainingIndexing} indexing codebase(s) remain`;
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

    public async handleGetIndexingStatus(args: any) {
        const { path: codebasePath } = args;

        try {
            // Force absolute path resolution
            const absolutePath = ensureAbsolutePath(codebasePath);

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

            // Check indexing status using snapshot plus cloud truth
            let status = this.snapshotManager.getCodebaseStatus(absolutePath);
            let info = this.snapshotManager.getCodebaseInfo(absolutePath);
            let recoveredFromCloud = false;
            const hasCloudIndex = await this.context.hasIndex(absolutePath);

            // Self-heal snapshot if cloud has index but local status is missing
            if (status === 'not_found' && hasCloudIndex) {
                this.snapshotManager.setCodebaseIndexed(absolutePath, {
                    indexedFiles: 0,
                    totalChunks: 0,
                    status: 'completed'
                });
                await this.snapshotManager.saveCodebaseSnapshot('status-reconcile-cloud-present');
                status = 'indexed';
                info = this.snapshotManager.getCodebaseInfo(absolutePath);
                recoveredFromCloud = true;
                console.log(`[STATUS] 🛠️ Restored missing snapshot entry from cloud index for: ${absolutePath}`);
            }

            // Cleanup stale snapshot entries if cloud index no longer exists
            if (status === 'indexed' && !hasCloudIndex) {
                this.snapshotManager.removeCodebaseCompletely(absolutePath);
                await this.snapshotManager.saveCodebaseSnapshot('status-reconcile-cloud-missing');
                status = 'not_found';
                info = undefined;
                console.log(`[STATUS] 🧹 Removed stale indexed snapshot entry without cloud index for: ${absolutePath}`);
            }

            let statusMessage = '';

            switch (status) {
                case 'indexed':
                    if (info && 'indexedFiles' in info) {
                        const indexedInfo = info as any;
                        statusMessage = `✅ Codebase '${absolutePath}' is fully indexed and ready for search.`;
                        statusMessage += `\n📊 Statistics: ${indexedInfo.indexedFiles} files, ${indexedInfo.totalChunks} chunks`;
                        statusMessage += `\n📅 Status: ${indexedInfo.indexStatus}`;
                        statusMessage += `\n🕐 Last updated: ${new Date(indexedInfo.lastUpdated).toLocaleString()}`;
                    } else {
                        statusMessage = `✅ Codebase '${absolutePath}' is fully indexed and ready for search.`;
                    }
                    if (recoveredFromCloud) {
                        statusMessage += `\nℹ️ Index was detected directly in vector database and local snapshot state was restored.`;
                    }
                    break;

                case 'indexing':
                    if (info && 'indexingPercentage' in info) {
                        const indexingInfo = info as any;
                        const progressPercentage = indexingInfo.indexingPercentage || 0;
                        statusMessage = `🔄 Codebase '${absolutePath}' is currently being indexed. Progress: ${progressPercentage.toFixed(1)}%`;

                        // Add more detailed status based on progress
                        if (progressPercentage < 10) {
                            statusMessage += ' (Preparing and scanning files...)';
                        } else if (progressPercentage < 100) {
                            statusMessage += ' (Processing files and generating embeddings...)';
                        }
                        statusMessage += `\n🕐 Last updated: ${new Date(indexingInfo.lastUpdated).toLocaleString()}`;
                    } else {
                        statusMessage = `🔄 Codebase '${absolutePath}' is currently being indexed.`;
                    }
                    break;

                case 'indexfailed':
                    if (info && 'errorMessage' in info) {
                        const failedInfo = info as any;
                        statusMessage = `❌ Codebase '${absolutePath}' indexing failed.`;
                        statusMessage += `\n🚨 Error: ${failedInfo.errorMessage}`;
                        if (failedInfo.lastAttemptedPercentage !== undefined) {
                            statusMessage += `\n📊 Failed at: ${failedInfo.lastAttemptedPercentage.toFixed(1)}% progress`;
                        }
                        statusMessage += `\n🕐 Failed at: ${new Date(failedInfo.lastUpdated).toLocaleString()}`;
                        statusMessage += `\n💡 You can retry indexing by running the index_codebase command again.`;
                    } else {
                        statusMessage = `❌ Codebase '${absolutePath}' indexing failed. You can retry indexing.`;
                    }
                    break;

                case 'not_found':
                default:
                    statusMessage = `❌ Codebase '${absolutePath}' is not indexed. Please use the index_codebase tool to index it first.`;
                    break;
            }

            const pathInfo = codebasePath !== absolutePath
                ? `\nNote: Input path '${codebasePath}' was resolved to absolute path '${absolutePath}'`
                : '';

            return {
                content: [{
                    type: "text",
                    text: statusMessage + pathInfo
                }]
            };

        } catch (error: any) {
            return {
                content: [{
                    type: "text",
                    text: `Error getting indexing status: ${error.message || error}`
                }],
                isError: true
            };
        }
    }
} 
