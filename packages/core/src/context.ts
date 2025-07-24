import {
    Splitter,
    CodeChunk,
    AstCodeSplitter
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
import { FileSynchronizer } from './sync/synchronizer';

const DEFAULT_SUPPORTED_EXTENSIONS = [
    // Programming languages
    '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
    '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.scala', '.m', '.mm',
    // Text and markup files
    '.md', '.markdown', '.ipynb',
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

export interface CodeContextConfig {
    embedding?: Embedding;
    vectorDatabase?: VectorDatabase;
    codeSplitter?: Splitter;
    supportedExtensions?: string[];
    ignorePatterns?: string[];
}

export class CodeContext {
    private embedding: Embedding;
    private vectorDatabase: VectorDatabase;
    private codeSplitter: Splitter;
    private supportedExtensions: string[];
    private ignorePatterns: string[];
    private synchronizers = new Map<string, FileSynchronizer>();

    constructor(config: CodeContextConfig = {}) {
        // Initialize services
        this.embedding = config.embedding || new OpenAIEmbedding({
            apiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key',
            model: 'text-embedding-3-small',
            ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL })
        });

        if (!config.vectorDatabase) {
            throw new Error('VectorDatabase is required. Please provide a vectorDatabase instance in the config.');
        }
        this.vectorDatabase = config.vectorDatabase;

        this.codeSplitter = config.codeSplitter || new AstCodeSplitter(2500, 300);

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
    ): Promise<{ indexedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached' }> {
        console.log(`🚀 Starting to index codebase: ${codebasePath}`);

        // 1. Check and prepare vector collection
        progressCallback?.({ phase: 'Preparing collection...', current: 0, total: 100, percentage: 0 });
        console.log(`Debug2: Preparing vector collection for codebase`);
        await this.prepareCollection(codebasePath);

        // 2. Recursively traverse codebase to get all supported files
        progressCallback?.({ phase: 'Scanning files...', current: 5, total: 100, percentage: 5 });
        const codeFiles = await this.getCodeFiles(codebasePath);
        console.log(`📁 Found ${codeFiles.length} code files`);

        if (codeFiles.length === 0) {
            progressCallback?.({ phase: 'No files to index', current: 100, total: 100, percentage: 100 });
            return { indexedFiles: 0, totalChunks: 0, status: 'completed' };
        }

        // 3. Process each file with streaming chunk processing
        // Reserve 10% for preparation, 90% for actual indexing
        const indexingStartPercentage = 10;
        const indexingEndPercentage = 100;
        const indexingRange = indexingEndPercentage - indexingStartPercentage;

        const result = await this.processFileList(
            codeFiles,
            codebasePath,
            (filePath, fileIndex, totalFiles) => {
                // Calculate progress percentage
                const progressPercentage = indexingStartPercentage + (fileIndex / totalFiles) * indexingRange;

                console.log(`📊 Processed ${fileIndex}/${totalFiles} files`);
                progressCallback?.({
                    phase: `Processing files (${fileIndex}/${totalFiles})...`,
                    current: fileIndex,
                    total: totalFiles,
                    percentage: Math.round(progressPercentage)
                });
            }
        );

        console.log(`✅ Codebase indexing completed! Processed ${result.processedFiles} files in total, generated ${result.totalChunks} code chunks`);

        progressCallback?.({
            phase: 'Indexing complete!',
            current: result.processedFiles,
            total: codeFiles.length,
            percentage: 100
        });

        return {
            indexedFiles: result.processedFiles,
            totalChunks: result.totalChunks,
            status: result.status
        };
    }

    async reindexByChange(
        codebasePath: string,
        progressCallback?: (progress: { phase: string; current: number; total: number; percentage: number }) => void
    ): Promise<{ added: number, removed: number, modified: number }> {
        const collectionName = this.getCollectionName(codebasePath);
        const synchronizer = this.synchronizers.get(collectionName);

        if (!synchronizer) {
            // To be safe, let's initialize if it's not there.
            const newSynchronizer = new FileSynchronizer(codebasePath, this.ignorePatterns);
            await newSynchronizer.initialize();
            this.synchronizers.set(collectionName, newSynchronizer);
        }

        const currentSynchronizer = this.synchronizers.get(collectionName)!;

        progressCallback?.({ phase: 'Checking for file changes...', current: 0, total: 100, percentage: 0 });
        const { added, removed, modified } = await currentSynchronizer.checkForChanges();
        const totalChanges = added.length + removed.length + modified.length;

        if (totalChanges === 0) {
            progressCallback?.({ phase: 'No changes detected', current: 100, total: 100, percentage: 100 });
            console.log('✅ No file changes detected.');
            return { added: 0, removed: 0, modified: 0 };
        }

        console.log(`🔄 Found changes: ${added.length} added, ${removed.length} removed, ${modified.length} modified.`);

        let processedChanges = 0;
        const updateProgress = (phase: string) => {
            processedChanges++;
            const percentage = Math.round((processedChanges / (removed.length + modified.length + added.length)) * 100);
            progressCallback?.({ phase, current: processedChanges, total: totalChanges, percentage });
        };

        // Handle removed files
        for (const file of removed) {
            await this.deleteFileChunks(collectionName, file);
            updateProgress(`Removed ${file}`);
        }

        // Handle modified files
        for (const file of modified) {
            await this.deleteFileChunks(collectionName, file);
            updateProgress(`Deleted old chunks for ${file}`);
        }

        // Handle added and modified files
        const filesToIndex = [...added, ...modified].map(f => path.join(codebasePath, f));

        if (filesToIndex.length > 0) {
            await this.processFileList(
                filesToIndex,
                codebasePath,
                (filePath, fileIndex, totalFiles) => {
                    updateProgress(`Indexed ${filePath} (${fileIndex}/${totalFiles})`);
                }
            );
        }

        console.log(`✅ Re-indexing complete. Added: ${added.length}, Removed: ${removed.length}, Modified: ${modified.length}`);
        progressCallback?.({ phase: 'Re-indexing complete!', current: totalChanges, total: totalChanges, percentage: 100 });

        return { added: added.length, removed: removed.length, modified: modified.length };
    }

    private async deleteFileChunks(collectionName: string, relativePath: string): Promise<void> {
        const results = await this.vectorDatabase.query(
            collectionName,
            `relativePath == "${relativePath}"`,
            ['id']
        );

        if (results.length > 0) {
            const ids = results.map(r => r.id as string).filter(id => id);
            if (ids.length > 0) {
                await this.vectorDatabase.delete(collectionName, ids);
                console.log(`Deleted ${ids.length} chunks for file ${relativePath}`);
            }
        }
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

        // Delete snapshot file
        await FileSynchronizer.deleteSnapshot(codebasePath);

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
        const uniquePatterns: string[] = [];
        const patternSet = new Set(mergedPatterns);
        patternSet.forEach(pattern => uniquePatterns.push(pattern));
        this.ignorePatterns = uniquePatterns;
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
     * Update splitter instance
     * @param splitter New splitter instance
     */
    updateSplitter(splitter: Splitter): void {
        this.codeSplitter = splitter;
        console.log(`🔄 Updated splitter instance`);
    }

    /**
     * Prepare vector collection
     */
    private async prepareCollection(codebasePath: string): Promise<void> {
        // Create new collection
        console.log(`🔧 Preparing vector collection for codebase: ${codebasePath}`);
        const collectionName = this.getCollectionName(codebasePath);

        // For Ollama embeddings, ensure dimension is detected before creating collection
        if (this.embedding.getProvider() === 'Ollama' && typeof (this.embedding as any).initializeDimension === 'function') {
            await (this.embedding as any).initializeDimension();
        }

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
 * Process a list of files with streaming chunk processing
 * @param filePaths Array of file paths to process
 * @param codebasePath Base path for the codebase
 * @param onFileProcessed Callback called when each file is processed
 * @returns Object with processed file count and total chunk count
 */
    private async processFileList(
        filePaths: string[],
        codebasePath: string,
        onFileProcessed?: (filePath: string, fileIndex: number, totalFiles: number) => void
    ): Promise<{ processedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached' }> {
        const EMBEDDING_BATCH_SIZE = Math.max(1, parseInt(process.env.EMBEDDING_BATCH_SIZE || '100', 10));
        const CHUNK_LIMIT = 450000;
        console.log(`🔧 Using EMBEDDING_BATCH_SIZE: ${EMBEDDING_BATCH_SIZE}`);

        let chunkBuffer: Array<{ chunk: CodeChunk; codebasePath: string }> = [];
        let processedFiles = 0;
        let totalChunks = 0;
        let limitReached = false;

        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];

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

                // Add chunks to buffer
                for (const chunk of chunks) {
                    chunkBuffer.push({ chunk, codebasePath });
                    totalChunks++;

                    // Process batch when buffer reaches EMBEDDING_BATCH_SIZE
                    if (chunkBuffer.length >= EMBEDDING_BATCH_SIZE) {
                        try {
                            await this.processChunkBuffer(chunkBuffer);
                        } catch (error) {
                            // TODO: 
                            console.error(`❌ Failed to process chunk batch: ${error}`);
                        } finally {
                            chunkBuffer = []; // Always clear buffer, even on failure
                        }
                    }

                    // Check if chunk limit is reached
                    if (totalChunks >= CHUNK_LIMIT) {
                        console.warn(`⚠️  Chunk limit of ${CHUNK_LIMIT} reached. Stopping indexing.`);
                        limitReached = true;
                        break; // Exit the inner loop (over chunks)
                    }
                }

                processedFiles++;
                onFileProcessed?.(filePath, i + 1, filePaths.length);

                if (limitReached) {
                    break; // Exit the outer loop (over files)
                }

            } catch (error) {
                console.warn(`⚠️  Skipping file ${filePath}: ${error}`);
            }
        }

        // Process any remaining chunks in the buffer
        if (chunkBuffer.length > 0) {
            console.log(`📝 Processing final batch of ${chunkBuffer.length} chunks`);
            try {
                await this.processChunkBuffer(chunkBuffer);
            } catch (error) {
                console.error(`❌ Failed to process final chunk batch: ${error}`);
            }
        }

        return {
            processedFiles,
            totalChunks,
            status: limitReached ? 'limit_reached' : 'completed'
        };
    }

    /**
 * Process accumulated chunk buffer
 */
    private async processChunkBuffer(chunkBuffer: Array<{ chunk: CodeChunk; codebasePath: string }>): Promise<void> {
        if (chunkBuffer.length === 0) return;

        // Extract chunks and ensure they all have the same codebasePath
        const chunks = chunkBuffer.map(item => item.chunk);
        const codebasePath = chunkBuffer[0].codebasePath;

        // Estimate tokens (rough estimation: 1 token ≈ 4 characters)
        const estimatedTokens = chunks.reduce((sum, chunk) => sum + Math.ceil(chunk.content.length / 4), 0);

        console.log(`🔄 Processing batch of ${chunks.length} chunks (~${estimatedTokens} tokens)`);
        await this.processChunkBatch(chunks, codebasePath);
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
            '.mm': 'objective-c',
            '.ipynb': 'jupyter'
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

    /**
     * Get current splitter information
     */
    getSplitterInfo(): { type: string; hasBuiltinFallback: boolean; supportedLanguages?: string[] } {
        const splitterName = this.codeSplitter.constructor.name;

        if (splitterName === 'AstCodeSplitter') {
            const { AstCodeSplitter } = require('./splitter/ast-splitter');
            return {
                type: 'ast',
                hasBuiltinFallback: true,
                supportedLanguages: AstCodeSplitter.getSupportedLanguages()
            };
        } else {
            return {
                type: 'langchain',
                hasBuiltinFallback: false
            };
        }
    }

    /**
     * Check if current splitter supports a specific language
     * @param language Programming language
     */
    isLanguageSupported(language: string): boolean {
        const splitterName = this.codeSplitter.constructor.name;

        if (splitterName === 'AstCodeSplitter') {
            const { AstCodeSplitter } = require('./splitter/ast-splitter');
            return AstCodeSplitter.isLanguageSupported(language);
        }

        // LangChain splitter supports most languages
        return true;
    }

    /**
     * Get which strategy would be used for a specific language
     * @param language Programming language
     */
    getSplitterStrategyForLanguage(language: string): { strategy: 'ast' | 'langchain'; reason: string } {
        const splitterName = this.codeSplitter.constructor.name;

        if (splitterName === 'AstCodeSplitter') {
            const { AstCodeSplitter } = require('./splitter/ast-splitter');
            const isSupported = AstCodeSplitter.isLanguageSupported(language);

            return {
                strategy: isSupported ? 'ast' : 'langchain',
                reason: isSupported
                    ? 'Language supported by AST parser'
                    : 'Language not supported by AST, will fallback to LangChain'
            };
        } else {
            return {
                strategy: 'langchain',
                reason: 'Using LangChain splitter directly'
            };
        }
    }
}
