import {
    Splitter,
    CodeChunk,
    LangChainCodeSplitter
} from './splitter';
import {
    Embedding,
    EmbeddingVector,
    OpenAIEmbedding
} from './embedding';
import {
    VectorDatabase,
    VectorDocument,
    VectorSearchResult
} from './vectordb';
import { SemanticSearchResult } from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const DEFAULT_SUPPORTED_EXTENSIONS = [
    // Programming languages
    '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
    '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.scala', '.m', '.mm',
    // Text and markup files
    '.md', '.markdown',
    // '.txt',  '.json', '.yaml', '.yml', '.xml', '.html', '.htm',
    // '.css', '.scss', '.less', '.sql', '.sh', '.bash', '.env'
];

const DEFAULT_IGNORE_PATTERNS = [
    // Common build output and dependency directories
    'node_modules/**',
    'dist/**',
    'build/**',
    'out/**',
    'target/**',
    'coverage/**',
    '.nyc_output/**',

    // IDE and editor files
    '.vscode/**',
    '.idea/**',
    '*.swp',
    '*.swo',

    // Version control
    '.git/**',
    '.svn/**',
    '.hg/**',

    // Cache directories
    '.cache/**',
    '__pycache__/**',
    '.pytest_cache/**',

    // Logs and temporary files
    'logs/**',
    'tmp/**',
    'temp/**',
    '*.log',

    // Environment and config files
    '.env',
    '.env.*',
    '*.local',

    // Minified and bundled files
    '*.min.js',
    '*.min.css',
    '*.min.map',
    '*.bundle.js',
    '*.bundle.css',
    '*.chunk.js',
    '*.vendor.js',
    '*.polyfills.js',
    '*.runtime.js',
    '*.map', // source map files
];

export interface CodeIndexerConfig {
    embedding?: Embedding;
    vectorDatabase?: VectorDatabase;
    codeSplitter?: Splitter;
    chunkSize?: number;
    chunkOverlap?: number;
    supportedExtensions?: string[];
    ignorePatterns?: string[];
}

export class CodeIndexer {
    private embedding: Embedding;
    private vectorDatabase: VectorDatabase;
    private codeSplitter: Splitter;
    private supportedExtensions: string[];
    private ignorePatterns: string[];

    constructor(config: CodeIndexerConfig = {}) {
        // Initialize services
        this.embedding = config.embedding || new OpenAIEmbedding({
            apiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key',
            model: 'text-embedding-3-small'
        });

        if (!config.vectorDatabase) {
            throw new Error('VectorDatabase is required. Please provide a vectorDatabase instance in the config.');
        }
        this.vectorDatabase = config.vectorDatabase;

        this.codeSplitter = config.codeSplitter || new LangChainCodeSplitter(
            config.chunkSize || 1000,
            config.chunkOverlap || 200
        );

        this.supportedExtensions = config.supportedExtensions || DEFAULT_SUPPORTED_EXTENSIONS;
        this.ignorePatterns = config.ignorePatterns || DEFAULT_IGNORE_PATTERNS;
    }

    /**
     * Generate collection name based on codebase path
     */
    private getCollectionName(codebasePath: string): string {
        const normalizedPath = path.resolve(codebasePath);
        const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
        return `code_chunks_${hash.substring(0, 8)}`;
    }

    /**
     * Index entire codebase
     * @param codebasePath Codebase path
     * @param progressCallback Optional progress callback function
     * @returns Indexing statistics
     */
    async indexCodebase(
        codebasePath: string,
        progressCallback?: (progress: { phase: string; current: number; total: number; percentage: number }) => void
    ): Promise<{ indexedFiles: number; totalChunks: number }> {
        console.log(`🚀 Starting to index codebase: ${codebasePath}`);

        // 1. Check and prepare vector collection
        progressCallback?.({ phase: 'Preparing collection...', current: 0, total: 100, percentage: 0 });
        await this.prepareCollection(codebasePath);

        // 2. Recursively traverse codebase to get all supported files
        progressCallback?.({ phase: 'Scanning files...', current: 5, total: 100, percentage: 5 });
        const codeFiles = await this.getCodeFiles(codebasePath);
        console.log(`📁 Found ${codeFiles.length} code files`);

        if (codeFiles.length === 0) {
            progressCallback?.({ phase: 'No files to index', current: 100, total: 100, percentage: 100 });
            return { indexedFiles: 0, totalChunks: 0 };
        }

        // 3. Process each file
        const indexedFiles = new Set<string>();
        let totalChunks = 0;
        const batchSize = 10; // Batch processing to avoid excessive memory usage

        // Reserve 10% for preparation, 90% for actual indexing
        const indexingStartPercentage = 10;
        const indexingEndPercentage = 100;
        const indexingRange = indexingEndPercentage - indexingStartPercentage;

        for (let i = 0; i < codeFiles.length; i += batchSize) {
            const batch = codeFiles.slice(i, i + batchSize);
            const batchStats = await this.processBatch(batch, codebasePath);
            batchStats.processedFiles.forEach(file => indexedFiles.add(file));
            totalChunks += batchStats.chunksGenerated;

            // Calculate progress percentage
            const filesProcessed = indexedFiles.size;
            const progressPercentage = indexingStartPercentage + (filesProcessed / codeFiles.length) * indexingRange;

            console.log(`📊 Processed ${filesProcessed}/${codeFiles.length} files`);
            progressCallback?.({
                phase: `Processing files (${filesProcessed}/${codeFiles.length})...`,
                current: filesProcessed,
                total: codeFiles.length,
                percentage: Math.round(progressPercentage)
            });
        }

        console.log(`✅ Codebase indexing completed! Processed ${indexedFiles.size} files in total, generated ${totalChunks} code chunks`);

        progressCallback?.({
            phase: 'Indexing complete!',
            current: indexedFiles.size,
            total: codeFiles.length,
            percentage: 100
        });

        return {
            indexedFiles: indexedFiles.size,
            totalChunks: totalChunks
        };
    }

    /**
     * Semantic search
     * @param codebasePath Codebase path to search in
     * @param query Search query
     * @param topK Number of results to return
     * @param threshold Similarity threshold
     */
    async semanticSearch(codebasePath: string, query: string, topK: number = 5, threshold: number = 0.5): Promise<SemanticSearchResult[]> {
        console.log(`🔍 Executing semantic search: "${query}" in ${codebasePath}`);

        // 1. Generate query vector
        const queryEmbedding: EmbeddingVector = await this.embedding.embed(query);

        // 2. Search in vector database
        const searchResults: VectorSearchResult[] = await this.vectorDatabase.search(
            this.getCollectionName(codebasePath),
            queryEmbedding.vector,
            { topK, threshold }
        );

        // 3. Convert to semantic search result format
        const results: SemanticSearchResult[] = searchResults.map(result => ({
            content: result.document.content,
            relativePath: result.document.relativePath,
            startLine: result.document.startLine,
            endLine: result.document.endLine,
            language: result.document.metadata.language || 'unknown',
            score: result.score
        }));

        console.log(`✅ Found ${results.length} relevant results`);
        return results;
    }

    /**
     * Check if index exists for codebase
     * @param codebasePath Codebase path to check
     * @returns Whether index exists
     */
    async hasIndex(codebasePath: string): Promise<boolean> {
        const collectionName = this.getCollectionName(codebasePath);
        return await this.vectorDatabase.hasCollection(collectionName);
    }

    /**
     * Clear index
     * @param codebasePath Codebase path to clear index for
     * @param progressCallback Optional progress callback function
     */
    async clearIndex(
        codebasePath: string,
        progressCallback?: (progress: { phase: string; current: number; total: number; percentage: number }) => void
    ): Promise<void> {
        console.log(`🧹 Cleaning index data for ${codebasePath}...`);

        progressCallback?.({ phase: 'Checking existing index...', current: 0, total: 100, percentage: 0 });

        const collectionName = this.getCollectionName(codebasePath);
        const collectionExists = await this.vectorDatabase.hasCollection(collectionName);

        progressCallback?.({ phase: 'Removing index data...', current: 50, total: 100, percentage: 50 });

        if (collectionExists) {
            await this.vectorDatabase.dropCollection(collectionName);
        }

        progressCallback?.({ phase: 'Index cleared', current: 100, total: 100, percentage: 100 });
        console.log('✅ Index data cleaned');
    }

    /**
     * Update ignore patterns (merges with default patterns)
     * @param ignorePatterns Array of ignore patterns to add to defaults
     */
    updateIgnorePatterns(ignorePatterns: string[]): void {
        // Merge with default patterns, avoiding duplicates
        const mergedPatterns = [...DEFAULT_IGNORE_PATTERNS, ...ignorePatterns];
        this.ignorePatterns = [...new Set(mergedPatterns)]; // Remove duplicates
        console.log(`🚫 Updated ignore patterns: ${ignorePatterns.length} from .gitignore + ${DEFAULT_IGNORE_PATTERNS.length} default = ${this.ignorePatterns.length} total patterns`);
    }

    /**
     * Reset ignore patterns to defaults only
     */
    resetIgnorePatternsToDefaults(): void {
        this.ignorePatterns = [...DEFAULT_IGNORE_PATTERNS];
        console.log(`🔄 Reset ignore patterns to defaults: ${this.ignorePatterns.length} patterns`);
    }

    /**
     * Update embedding instance
     * @param embedding New embedding instance
     */
    updateEmbedding(embedding: Embedding): void {
        this.embedding = embedding;
        console.log(`🔄 Updated embedding provider: ${embedding.getProvider()}`);
    }

    /**
     * Update vector database instance
     * @param vectorDatabase New vector database instance
     */
    updateVectorDatabase(vectorDatabase: VectorDatabase): void {
        this.vectorDatabase = vectorDatabase;
        console.log(`🔄 Updated vector database`);
    }

    /**
     * Prepare vector collection
     */
    private async prepareCollection(codebasePath: string): Promise<void> {
        // Create new collection
        const collectionName = this.getCollectionName(codebasePath);
        const dimension = this.embedding.getDimension();
        await this.vectorDatabase.createCollection(collectionName, dimension, `Code chunk vector storage collection for codebase: ${codebasePath}`);
        console.log(`✅ Collection ${collectionName} created successfully (dimension: ${dimension})`);
    }

    /**
     * Recursively get all code files in the codebase
     */
    private async getCodeFiles(codebasePath: string): Promise<string[]> {
        const files: string[] = [];

        const traverseDirectory = async (currentPath: string) => {
            const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);

                // Check if path matches ignore patterns
                if (this.matchesIgnorePattern(fullPath, codebasePath)) {
                    continue;
                }

                if (entry.isDirectory()) {
                    // Skip common ignored directories
                    if (!this.shouldIgnoreDirectory(entry.name)) {
                        await traverseDirectory(fullPath);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name);
                    if (this.supportedExtensions.includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        };

        await traverseDirectory(codebasePath);
        return files;
    }

    /**
     * Determine whether directory should be ignored
     */
    private shouldIgnoreDirectory(dirName: string): boolean {
        const ignoredDirs = [
            'node_modules', '.git', '.svn', '.hg', 'build', 'dist', 'out',
            'target', '.vscode', '.idea', '__pycache__', '.pytest_cache',
            'coverage', '.nyc_output', 'logs', 'tmp', 'temp'
        ];
        return ignoredDirs.includes(dirName) || dirName.startsWith('.');
    }

    /**
     * Process files in batch
     */
    private async processBatch(filePaths: string[], codebasePath: string): Promise<{ processedFiles: string[]; chunksGenerated: number }> {
        const allChunks: CodeChunk[] = [];
        const processedFiles: string[] = [];

        // 1. Read and split files in parallel
        for (const filePath of filePaths) {
            try {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const language = this.getLanguageFromExtension(path.extname(filePath));
                const chunks = await this.codeSplitter.split(content, language, filePath);

                // Log files with many chunks or large content
                if (chunks.length > 50) {
                    console.warn(`⚠️  File ${filePath} generated ${chunks.length} chunks (${Math.round(content.length / 1024)}KB)`);
                } else if (content.length > 100000) {
                    console.log(`📄 Large file ${filePath}: ${Math.round(content.length / 1024)}KB -> ${chunks.length} chunks`);
                }

                allChunks.push(...chunks);
                processedFiles.push(filePath);
            } catch (error) {
                console.warn(`⚠️  Skipping file ${filePath}: ${error}`);
            }
        }

        if (allChunks.length === 0) {
            return { processedFiles, chunksGenerated: 0 };
        }

        console.log(`📝 Processing ${allChunks.length} chunks from ${processedFiles.length} files`);

        // 2. Process chunks in smaller batches to avoid token limits
        const MAX_CHUNKS_PER_BATCH = 100; // Limit chunks per embedding batch
        const MAX_ESTIMATED_TOKENS = 200000; // Conservative token limit
        let totalProcessedChunks = 0;

        for (let i = 0; i < allChunks.length; i += MAX_CHUNKS_PER_BATCH) {
            const chunkBatch = allChunks.slice(i, i + MAX_CHUNKS_PER_BATCH);

            // Estimate tokens (rough estimation: 1 token ≈ 4 characters)
            const estimatedTokens = chunkBatch.reduce((sum, chunk) => sum + Math.ceil(chunk.content.length / 4), 0);

            if (estimatedTokens > MAX_ESTIMATED_TOKENS) {
                console.warn(`⚠️  Chunk batch has ~${estimatedTokens} tokens, splitting further...`);
                // Process chunks one by one if batch is still too large
                for (const chunk of chunkBatch) {
                    await this.processSingleChunk(chunk, codebasePath);
                    totalProcessedChunks++;
                }
            } else {
                console.log(`🔄 Processing chunk batch ${Math.floor(i / MAX_CHUNKS_PER_BATCH) + 1} with ${chunkBatch.length} chunks (~${estimatedTokens} tokens)`);
                await this.processChunkBatch(chunkBatch, codebasePath);
                totalProcessedChunks += chunkBatch.length;
            }
        }

        return { processedFiles, chunksGenerated: totalProcessedChunks };
    }

    /**
     * Process a batch of chunks
     */
    private async processChunkBatch(chunks: CodeChunk[], codebasePath: string): Promise<void> {
        // Generate embedding vectors
        const chunkContents = chunks.map(chunk => chunk.content);
        const embeddings: EmbeddingVector[] = await this.embedding.embedBatch(chunkContents);

        // Prepare vector documents
        const documents: VectorDocument[] = chunks.map((chunk, index) => {
            if (!chunk.metadata.filePath) {
                throw new Error(`Missing filePath in chunk metadata at index ${index}`);
            }

            const relativePath = path.relative(codebasePath, chunk.metadata.filePath);
            const fileExtension = path.extname(chunk.metadata.filePath);

            // Extract metadata that should be stored separately
            const { filePath, startLine, endLine, ...restMetadata } = chunk.metadata;

            return {
                id: this.generateId(relativePath, chunk.metadata.startLine || 0, chunk.metadata.endLine || 0, chunk.content),
                vector: embeddings[index].vector,
                content: chunk.content,
                relativePath,
                startLine: chunk.metadata.startLine || 0,
                endLine: chunk.metadata.endLine || 0,
                fileExtension,
                metadata: {
                    ...restMetadata,
                    codebasePath,
                    language: chunk.metadata.language || 'unknown',
                    chunkIndex: index
                }
            };
        });

        // Store to vector database
        await this.vectorDatabase.insert(this.getCollectionName(codebasePath), documents);
    }

    /**
     * Process a single chunk (fallback for very large chunks)
     */
    private async processSingleChunk(chunk: CodeChunk, codebasePath: string): Promise<void> {
        if (!chunk.metadata.filePath) {
            throw new Error(`Missing filePath in chunk metadata`);
        }

        // Check if chunk is too large even for single processing
        const estimatedTokens = Math.ceil(chunk.content.length / 4);
        if (estimatedTokens > 250000) { // Very conservative limit for single chunk
            console.warn(`⚠️  Skipping extremely large chunk (~${estimatedTokens} tokens) from ${chunk.metadata.filePath}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`);
            return;
        }

        console.log(`🔄 Processing single large chunk (~${estimatedTokens} tokens) from ${chunk.metadata.filePath}`);

        // Generate embedding vector
        const embedding: EmbeddingVector = await this.embedding.embed(chunk.content);

        const relativePath = path.relative(codebasePath, chunk.metadata.filePath);
        const fileExtension = path.extname(chunk.metadata.filePath);

        // Extract metadata that should be stored separately
        const { filePath, startLine, endLine, ...restMetadata } = chunk.metadata;

        const document: VectorDocument = {
            id: this.generateId(relativePath, chunk.metadata.startLine || 0, chunk.metadata.endLine || 0, chunk.content),
            vector: embedding.vector,
            content: chunk.content,
            relativePath,
            startLine: chunk.metadata.startLine || 0,
            endLine: chunk.metadata.endLine || 0,
            fileExtension,
            metadata: {
                ...restMetadata,
                codebasePath,
                language: chunk.metadata.language || 'unknown',
                chunkIndex: 0
            }
        };

        // Store to vector database
        await this.vectorDatabase.insert(this.getCollectionName(codebasePath), [document]);
    }

    /**
     * Get programming language based on file extension
     */
    private getLanguageFromExtension(ext: string): string {
        const languageMap: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.py': 'python',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.h': 'c',
            '.hpp': 'cpp',
            '.cs': 'csharp',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.rb': 'ruby',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.m': 'objective-c',
            '.mm': 'objective-c'
        };
        return languageMap[ext] || 'text';
    }

    /**
     * Generate unique ID based on chunk content and location
     * @param relativePath Relative path to the file
     * @param startLine Start line number
     * @param endLine End line number
     * @param content Chunk content
     * @returns Hash-based unique ID
     */
    private generateId(relativePath: string, startLine: number, endLine: number, content: string): string {
        const combinedString = `${relativePath}:${startLine}:${endLine}:${content}`;
        const hash = crypto.createHash('sha256').update(combinedString, 'utf-8').digest('hex');
        return `chunk_${hash.substring(0, 16)}`;
    }

    /**
     * Read ignore patterns from file (e.g., .gitignore)
     * @param filePath Path to the ignore file
     * @returns Array of ignore patterns
     */
    static async getIgnorePatternsFromFile(filePath: string): Promise<string[]> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#')); // Filter out empty lines and comments
        } catch (error) {
            console.warn(`⚠️  Could not read ignore file ${filePath}: ${error}`);
            return [];
        }
    }

    /**
     * Check if a path matches any ignore pattern
     * @param filePath Path to check
     * @param basePath Base path for relative pattern matching
     * @returns True if path should be ignored
     */
    private matchesIgnorePattern(filePath: string, basePath: string): boolean {
        if (this.ignorePatterns.length === 0) {
            return false;
        }

        const relativePath = path.relative(basePath, filePath);
        const normalizedPath = relativePath.replace(/\\/g, '/'); // Normalize path separators

        for (const pattern of this.ignorePatterns) {
            if (this.isPatternMatch(normalizedPath, pattern)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Simple glob pattern matching
     * @param filePath File path to test
     * @param pattern Glob pattern
     * @returns True if pattern matches
     */
    private isPatternMatch(filePath: string, pattern: string): boolean {
        // Handle directory patterns (ending with /)
        if (pattern.endsWith('/')) {
            const dirPattern = pattern.slice(0, -1);
            const pathParts = filePath.split('/');
            return pathParts.some(part => this.simpleGlobMatch(part, dirPattern));
        }

        // Handle file patterns
        if (pattern.includes('/')) {
            // Pattern with path separator - match exact path
            return this.simpleGlobMatch(filePath, pattern);
        } else {
            // Pattern without path separator - match filename in any directory
            const fileName = path.basename(filePath);
            return this.simpleGlobMatch(fileName, pattern);
        }
    }

    /**
     * Simple glob matching supporting * wildcard
     * @param text Text to test
     * @param pattern Pattern with * wildcards
     * @returns True if pattern matches
     */
    private simpleGlobMatch(text: string, pattern: string): boolean {
        // Convert glob pattern to regex
        const regexPattern = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
            .replace(/\*/g, '.*'); // Convert * to .*

        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(text);
    }
}
