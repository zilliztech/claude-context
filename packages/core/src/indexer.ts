import {
    CodeSplitter,
    CodeChunk,
    LangChainCodeSplitter
} from './splitter';
import {
    Embedding,
    EmbeddingVector,
    OpenAIEmbeddingService
} from './embedding';
import {
    VectorDatabase,
    VectorDocument,
    VectorSearchResult,
    MilvusVectorDatabase
} from './vectordb';
import * as fs from 'fs';
import * as path from 'path';

export interface CodeIndexerConfig {
    embeddingService?: Embedding;
    vectorDatabase?: VectorDatabase;
    codeSplitter?: CodeSplitter;
    chunkSize?: number;
    chunkOverlap?: number;
    collectionName?: string;
    supportedExtensions?: string[];
}

export interface SemanticSearchResult {
    content: string;
    filePath: string;
    startLine: number;
    endLine: number;
    language: string;
    score: number;
}

export class CodeIndexer {
    private embeddingService: Embedding;
    private vectorDatabase: VectorDatabase;
    private codeSplitter: CodeSplitter;
    private collectionName: string;
    private supportedExtensions: string[];
    private indexedFiles: Set<string> = new Set();
    private totalChunks: number = 0;

    constructor(config: CodeIndexerConfig = {}) {
        // Initialize services
        this.embeddingService = config.embeddingService || new OpenAIEmbeddingService({
            apiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key',
            model: 'text-embedding-3-small'
        });

        this.vectorDatabase = config.vectorDatabase || new MilvusVectorDatabase({
            address: process.env.MILVUS_ADDRESS || 'localhost:19530'
        });

        this.codeSplitter = config.codeSplitter || new LangChainCodeSplitter(
            config.chunkSize || 1000,
            config.chunkOverlap || 200
        );

        this.collectionName = config.collectionName || 'code_chunks';

        this.supportedExtensions = config.supportedExtensions || [
            '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
            '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.scala', '.m', '.mm'
        ];
    }

    /**
     * Index entire codebase
     * @param codebasePath Codebase path
     */
    async indexCodebase(codebasePath: string): Promise<void> {
        console.log(`🚀 Starting to index codebase: ${codebasePath}`);

        // 1. Check and prepare vector collection
        await this.prepareCollection();

        // 2. Recursively traverse codebase to get all supported files
        const codeFiles = await this.getCodeFiles(codebasePath);
        console.log(`📁 Found ${codeFiles.length} code files`);

        // 3. Process each file
        let processedFiles = 0;
        const batchSize = 10; // Batch processing to avoid excessive memory usage

        for (let i = 0; i < codeFiles.length; i += batchSize) {
            const batch = codeFiles.slice(i, i + batchSize);
            await this.processBatch(batch);
            processedFiles += batch.length;
            console.log(`📊 Processed ${processedFiles}/${codeFiles.length} files`);
        }

        console.log(`✅ Codebase indexing completed! Processed ${processedFiles} files in total, generated ${this.totalChunks} code chunks`);
    }

    /**
     * Semantic search
     * @param query Search query
     * @param topK Number of results to return
     * @param threshold Similarity threshold
     */
    async semanticSearch(query: string, topK: number = 5, threshold: number = 0.5): Promise<SemanticSearchResult[]> {
        console.log(`🔍 Executing semantic search: "${query}"`);

        // 1. Generate query vector
        const queryEmbedding: EmbeddingVector = await this.embeddingService.embed(query);

        // 2. Search in vector database
        const searchResults: VectorSearchResult[] = await this.vectorDatabase.search(
            this.collectionName,
            queryEmbedding.vector,
            { topK, threshold }
        );

        // 3. Convert to semantic search result format
        const results: SemanticSearchResult[] = searchResults.map(result => ({
            content: result.document.content,
            filePath: result.document.metadata.filePath || 'unknown',
            startLine: result.document.metadata.startLine || 0,
            endLine: result.document.metadata.endLine || 0,
            language: result.document.metadata.language || 'unknown',
            score: result.score
        }));

        console.log(`✅ Found ${results.length} relevant results`);
        return results;
    }

    /**
     * Get index statistics
     */
    getStats(): { indexedFiles: number; totalChunks: number } {
        return {
            indexedFiles: this.indexedFiles.size,
            totalChunks: this.totalChunks
        };
    }

    /**
     * Clear index
     */
    async clearIndex(): Promise<void> {
        console.log('🧹 Cleaning index data...');

        const collectionExists = await this.vectorDatabase.hasCollection(this.collectionName);
        if (collectionExists) {
            await this.vectorDatabase.dropCollection(this.collectionName);
        }

        this.indexedFiles.clear();
        this.totalChunks = 0;
        console.log('✅ Index data cleaned');
    }

    /**
     * Prepare vector collection
     */
    private async prepareCollection(): Promise<void> {
        // Create new collection
        const dimension = this.embeddingService.getDimension();
        await this.vectorDatabase.createCollection(this.collectionName, dimension, 'Code chunk vector storage collection');
        console.log(`✅ Collection ${this.collectionName} created successfully (dimension: ${dimension})`);
    }

    /**
     * Recursively get all code files in the codebase
     */
    private async getCodeFiles(dirPath: string): Promise<string[]> {
        const files: string[] = [];

        const traverseDirectory = async (currentPath: string) => {
            const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);

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

        await traverseDirectory(dirPath);
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
    private async processBatch(filePaths: string[]): Promise<void> {
        const allChunks: CodeChunk[] = [];

        // 1. Read and split files in parallel
        for (const filePath of filePaths) {
            try {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const language = this.getLanguageFromExtension(path.extname(filePath));
                const chunks = await this.codeSplitter.split(content, language, filePath);

                allChunks.push(...chunks);
                this.indexedFiles.add(filePath);
            } catch (error) {
                console.warn(`⚠️  Skipping file ${filePath}: ${error}`);
            }
        }

        if (allChunks.length === 0) {
            return;
        }

        // 2. Generate embedding vectors
        const chunkContents = allChunks.map(chunk => chunk.content);
        const embeddings: EmbeddingVector[] = await this.embeddingService.embedBatch(chunkContents);

        // 3. Prepare vector documents
        const documents: VectorDocument[] = allChunks.map((chunk, index) => ({
            id: this.generateId(),
            vector: embeddings[index].vector,
            content: chunk.content,
            metadata: {
                ...chunk.metadata,
                chunkIndex: index,
                language: chunk.metadata.language || 'unknown'
            }
        }));

        // 4. Store to vector database
        await this.vectorDatabase.insert(this.collectionName, documents);
        this.totalChunks += documents.length;
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
     * Generate unique ID
     */
    private generateId(): string {
        return `chunk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Export a default instance for convenience
export const codeIndexer = new CodeIndexer();
