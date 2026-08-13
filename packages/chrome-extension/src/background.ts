// Chrome Extension Background Script with Milvus Integration
// This replaces the IndexedDB-based storage with Milvus RESTful API

import { ChromeMilvusAdapter, CodeChunk } from './milvus/chromeMilvusAdapter';
import { MilvusConfigManager } from './config/milvusConfig';
import { IndexedRepoManager, IndexedRepository } from './storage/indexedRepoManager';

export { };

const EMBEDDING_DIM = 1536;
const EMBEDDING_BATCH_SIZE = 100;
const MAX_TOKENS_PER_BATCH = 250000;
const MAX_CHUNKS_PER_BATCH = 100;

// Cosine similarity function
function cosSim(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

class EmbeddingModel {
    private static config: { apiKey: string; model: string } | null = null;

    private static async getConfig(): Promise<{ apiKey: string; model: string }> {
        if (!this.config) {
            const config = await MilvusConfigManager.getOpenAIConfig();
            if (!config) {
                throw new Error('OpenAI API key is not configured.');
            }
            this.config = config;
        }
        return this.config;
    }

    static async embedBatch(texts: string[]): Promise<number[][]> {
        const config = await this.getConfig();

        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model,
                input: texts,
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`OpenAI API error: ${response.status} - ${text}`);
        }

        const json = await response.json();
        return json.data.map((d: any) => d.embedding as number[]);
    }

    static async embedSingle(text: string): Promise<number[]> {
        const results = await this.embedBatch([text]);
        return results[0];
    }

    static async getInstance(_progress_callback: Function | undefined = undefined): Promise<(input: string | string[], options?: any) => Promise<{ data: number[] }>> {
        return async (input: string | string[], _opts: any = {}): Promise<{ data: number[] }> => {
            if (Array.isArray(input)) {
                const embeddings = await this.embedBatch(input);
                return { data: embeddings.flat() };
            } else {
                const embedding = await this.embedSingle(input);
                return { data: embedding };
            }
        };
    }
}
class MilvusVectorDB {
    private adapter: ChromeMilvusAdapter;
    public readonly repoCollectionName: string;

    constructor(repoId: string) {
        this.repoCollectionName = `chrome_repo_${repoId.replace(/[^a-zA-Z0-9]/g, '_')}`;
        this.adapter = new ChromeMilvusAdapter(this.repoCollectionName);
    }

    async initialize(): Promise<void> {
        try {
            await this.adapter.initialize();
            const exists = await this.adapter.collectionExists();
            if (!exists) {
                await this.adapter.createCollection(EMBEDDING_DIM);
            }
        } catch (error) {
            console.error('Failed to initialize Milvus:', error);
            throw error;
        }
    }

    async addChunks(chunks: CodeChunk[]): Promise<void> {
        if (chunks.length === 0) return;

        try {
            await this.adapter.insertChunks(chunks);
        } catch (error) {
            console.error('Failed to add chunks to Milvus:', error);
            throw error;
        }
    }

    async searchSimilar(queryVector: number[], limit: number = 20): Promise<CodeChunk[]> {
        try {
            const results = await this.adapter.searchSimilar(queryVector, limit, 0.3);

            return results.map(result => ({
                id: result.id,
                content: result.content,
                relativePath: result.relativePath,
                startLine: result.startLine,
                endLine: result.endLine,
                fileExtension: result.fileExtension,
                metadata: result.metadata,
                score: result.score, // Include score for frontend display
                vector: [] // Vector not needed for display
            }));
        } catch (error) {
            console.error('Failed to search in Milvus:', error);
            throw error;
        }
    }

    async clear(): Promise<void> {
        try {
            await this.adapter.clearCollection();
            // Recreate the collection
            await this.adapter.createCollection(EMBEDDING_DIM);
        } catch (error) {
            console.error('Failed to clear Milvus collection:', error);
            throw error;
        }
    }

    async getStats(): Promise<{ totalChunks: number } | null> {
        try {
            const stats = await this.adapter.getCollectionStats();
            return stats ? { totalChunks: stats.totalEntities } : null;
        } catch (error) {
            console.error('Failed to get Milvus stats:', error);
            return null;
        }
    }
}

// Code splitting functionality - using same parameters as VSCode extension
function splitCode(content: string, language: string = '', chunkSize: number = 1000, chunkOverlap: number = 200): { content: string; startLine: number; endLine: number }[] {
    const lines = content.split('\n');
    const chunks: { content: string; startLine: number; endLine: number }[] = [];

    // Simple character-based chunking that approximates LangChain's RecursiveCharacterTextSplitter
    let currentChunk: string[] = [];
    let currentSize = 0;
    let startLine = 1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineSize = line.length + 1; // +1 for newline

        if (currentSize + lineSize > chunkSize && currentChunk.length > 0) {
            // Create chunk
            const chunkContent = currentChunk.join('\n');
            chunks.push({
                content: chunkContent,
                startLine: startLine,
                endLine: startLine + currentChunk.length - 1
            });

            // Create overlap - use line-based overlap instead of character-based
            const overlapLines = Math.min(
                Math.floor(chunkOverlap / (chunkContent.length / currentChunk.length)),
                currentChunk.length
            );

            const newStartLine = startLine + currentChunk.length - overlapLines;
            currentChunk = currentChunk.slice(-overlapLines);
            currentSize = currentChunk.join('\n').length;
            startLine = newStartLine;
        }

        currentChunk.push(line);
        currentSize += lineSize;
    }

    if (currentChunk.length > 0) {
        chunks.push({
            content: currentChunk.join('\n'),
            startLine: startLine,
            endLine: startLine + currentChunk.length - 1
        });
    }

    return chunks.filter(chunk => chunk.content.trim().length > 0);
}

// GitHub API helpers (reused from original)
async function validateGitHubToken(token: string): Promise<boolean> {
    try {
        const response = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        if (response.status === 401) {
            throw new Error('Invalid GitHub token or token has expired');
        }

        if (response.status === 403) {
            const remainingRequests = response.headers.get('X-RateLimit-Remaining');
            if (remainingRequests === '0') {
                throw new Error('GitHub API rate limit exceeded. Please try again later.');
            }
            throw new Error('GitHub token does not have sufficient permissions');
        }

        return response.ok;
    } catch (error) {
        console.error('GitHub token validation failed:', error);
        throw error;
    }
}

async function getGitHubToken(): Promise<string> {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(['githubToken'], async (items) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else if (!items.githubToken) {
                reject(new Error('GitHub token not found. Please configure your GitHub token in the extension settings.'));
            } else {
                try {
                    // Validate token before returning
                    await validateGitHubToken(items.githubToken);
                    resolve(items.githubToken);
                } catch (error) {
                    reject(new Error(`GitHub token validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }
            }
        });
    });
}

// Check repository access
async function checkRepositoryAccess(owner: string, repo: string): Promise<void> {
    const token = await getGitHubToken();
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

    const response = await fetch(apiUrl, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });

    if (response.status === 404) {
        throw new Error('Repository not found or you do not have access to it. Please check the repository name and ensure your GitHub token has the necessary permissions.');
    }

    if (response.status === 403) {
        const remainingRequests = response.headers.get('X-RateLimit-Remaining');
        if (remainingRequests === '0') {
            throw new Error('GitHub API rate limit exceeded. Please try again later.');
        }
        throw new Error('Access forbidden. Your GitHub token may not have sufficient permissions to access this repository.');
    }

    if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} - ${await response.text()}`);
    }
}

// Rate limiting helper
async function handleRateLimit(response: Response): Promise<void> {
    if (response.status === 403) {
        const remainingRequests = response.headers.get('X-RateLimit-Remaining');
        const resetTime = response.headers.get('X-RateLimit-Reset');

        if (remainingRequests === '0' && resetTime) {
            const resetDate = new Date(parseInt(resetTime) * 1000);
            const waitTime = resetDate.getTime() - Date.now();

            if (waitTime > 0 && waitTime < 3600000) { // Wait up to 1 hour
                console.log(`Rate limit exceeded. Waiting ${Math.ceil(waitTime / 1000)} seconds...`);
                await new Promise(resolve => setTimeout(resolve, waitTime + 1000));
            } else {
                throw new Error('GitHub API rate limit exceeded. Please try again later.');
            }
        }
    }
}

async function fetchRepoFiles(owner: string, repo: string): Promise<any[]> {
    const token = await getGitHubToken();

    // First get the default branch
    const repoInfoUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const repoResponse = await fetch(repoInfoUrl, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });

    if (!repoResponse.ok) {
        throw new Error(`GitHub API error: ${repoResponse.status} - ${await repoResponse.text()}`);
    }

    const repoData = await repoResponse.json();
    const defaultBranch = repoData.default_branch || 'main';

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`;

    const response = await fetch(apiUrl, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });

    if (!response.ok) {
        await handleRateLimit(response);
        throw new Error(`GitHub API error: ${response.status} - ${await response.text()}`);
    }

    const data = await response.json();
    return data.tree.filter((item: any) =>
        item.type === 'blob' &&
        item.path.match(/\.(ts|tsx|js|jsx|py|java|cpp|c|h|hpp|cs|go|rs|php|rb|swift|kt|scala|m|mm|md)$/)
    );
}

async function fetchFileContent(owner: string, repo: string, path: string): Promise<string> {
    const token = await getGitHubToken();
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const response = await fetch(apiUrl, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });

    if (!response.ok) {
        await handleRateLimit(response);
        throw new Error(`Failed to fetch file: ${response.status} - ${await response.text()}`);
    }

    const data = await response.json();
    if (data.content) {
        return atob(data.content.replace(/\n/g, ''));
    }

    throw new Error('File content not available');
}

// Main message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'indexRepo') {
        handleIndexRepo(request, sendResponse);
        return true; // Keep message channel open
    } else if (request.action === 'searchCode') {
        handleSearchCode(request, sendResponse);
        return true;
    } else if (request.action === 'clearIndex') {
        handleClearIndex(request, sendResponse);
        return true;
    } else if (request.action === 'testMilvusConnection') {
        handleTestMilvusConnection(sendResponse);
        return true;
    } else if (request.action === 'checkIndexStatus') {
        handleCheckIndexStatus(request, sendResponse);
        return true;
    } else if (request.action === 'getIndexedRepos') {
        handleGetIndexedRepos(sendResponse);
        return true;
    }
});

async function handleTestMilvusConnection(sendResponse: Function) {
    try {
        console.log('Testing Milvus connection...');

        const adapter = new ChromeMilvusAdapter('test_connection');
        const connected = await adapter.testConnection();

        console.log('Milvus connection test completed successfully');
        sendResponse({ success: true, connected: true });
    } catch (error) {
        console.error('Milvus connection test failed:', error);

        let errorMessage = 'Unknown error';
        if (error instanceof Error) {
            errorMessage = error.message;
        } else if (typeof error === 'string') {
            errorMessage = error;
        }

        // Provide more specific error messages based on common issues
        if (errorMessage.includes('fetch')) {
            errorMessage = 'Network error: Unable to connect to Milvus server. Check address and network connectivity.';
        } else if (errorMessage.includes('CORS')) {
            errorMessage = 'CORS error: Cross-origin request blocked. Check server CORS configuration.';
        } else if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
            errorMessage = 'Authentication failed: Check your Milvus token or username/password.';
        } else if (errorMessage.includes('404')) {
            errorMessage = 'Server not found: Check your Milvus server address.';
        }

        sendResponse({
            success: false,
            connected: false,
            error: errorMessage
        });
    }
}

async function handleIndexRepo(request: any, sendResponse: Function) {
    try {
        const { owner, repo } = request;
        const repoId = `${owner}/${repo}`;

        sendResponse({ success: true, message: 'Starting indexing process...' });

        // Check repository access first
        await checkRepositoryAccess(owner, repo);

        // Initialize Milvus
        const vectorDB = new MilvusVectorDB(repoId);
        await vectorDB.initialize();

        // Use fixed chunking configuration (same as VSCode extension)
        const chunkSize = 1000;  // Same as VSCode extension default
        const chunkOverlap = 200;  // Same as VSCode extension default

        // Fetch repository files
        const files = await fetchRepoFiles(owner, repo);
        console.log(`Found ${files.length} files to index`);

        // Process files using core package approach
        const result = await processFileList(files, owner, repo, repoId, vectorDB, chunkSize, chunkOverlap);

        // Send completion message
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'indexComplete',
                    stats: { indexedFiles: result.processedFiles, totalChunks: result.totalChunks }
                });
            }
        });

        await IndexedRepoManager.addIndexedRepo({
            id: repoId,
            owner,
            repo,
            totalFiles: result.processedFiles,
            totalChunks: result.totalChunks,
            collectionName: vectorDB.repoCollectionName
        });

    } catch (error) {
        console.error('Indexing failed:', error);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'indexError',
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });
    }
}

async function processFileList(
    files: any[],
    owner: string,
    repo: string,
    repoId: string,
    vectorDB: MilvusVectorDB,
    chunkSize: number,
    chunkOverlap: number
): Promise<{ processedFiles: number; totalChunks: number }> {
    console.log(`🔧 Using EMBEDDING_BATCH_SIZE: ${EMBEDDING_BATCH_SIZE}`);

    let chunkBuffer: Array<{ chunk: CodeChunk; repoId: string }> = [];
    let processedFiles = 0;
    let totalChunks = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        try {
            const content = await fetchFileContent(owner, repo, file.path);
            const fileExtension = file.path.split('.').pop() || '';
            const chunks = splitCode(content, fileExtension, chunkSize, chunkOverlap);

            // Log files with many chunks or large content
            if (chunks.length > 50) {
                console.warn(`⚠️  File ${file.path} generated ${chunks.length} chunks (${Math.round(content.length / 1024)}KB)`);
            } else if (content.length > 100000) {
                console.log(`📄 Large file ${file.path}: ${Math.round(content.length / 1024)}KB -> ${chunks.length} chunks`);
            }

            // Add chunks to buffer
            for (let j = 0; j < chunks.length; j++) {
                const chunk = chunks[j];
                if (chunk.content.trim().length > 10) {
                    const codeChunk: CodeChunk = {
                        id: `${file.path}_chunk_${j}`,
                        content: chunk.content,
                        relativePath: file.path,
                        startLine: chunk.startLine,
                        endLine: chunk.endLine,
                        fileExtension: fileExtension,
                        metadata: JSON.stringify({
                            repoId,
                            fileSize: file.size,
                            chunkIndex: j
                        })
                    };

                    chunkBuffer.push({ chunk: codeChunk, repoId });
                    totalChunks++;

                    // Process batch when buffer reaches EMBEDDING_BATCH_SIZE
                    if (chunkBuffer.length >= EMBEDDING_BATCH_SIZE) {
                        try {
                            await processChunkBuffer(chunkBuffer, vectorDB);
                        } catch (error) {
                            console.error(`❌ Failed to process chunk batch: ${error}`);
                        } finally {
                            chunkBuffer = []; // Always clear buffer, even on failure
                        }
                    }
                }
            }

            processedFiles++;

            // Send progress update
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'indexProgress',
                        progress: `Indexed ${processedFiles}/${files.length} files (${totalChunks} chunks)`
                    });
                }
            });

        } catch (error) {
            console.warn(`⚠️  Skipping file ${file.path}: ${error}`);
        }
    }

    // Process any remaining chunks in the buffer
    if (chunkBuffer.length > 0) {
        console.log(`📝 Processing final batch of ${chunkBuffer.length} chunks`);
        try {
            await processChunkBuffer(chunkBuffer, vectorDB);
        } catch (error) {
            console.error(`❌ Failed to process final chunk batch: ${error}`);
        }
    }

    return { processedFiles, totalChunks };
}

async function processChunkBuffer(
    chunkBuffer: Array<{ chunk: CodeChunk; repoId: string }>,
    vectorDB: MilvusVectorDB
): Promise<void> {
    if (chunkBuffer.length === 0) return;

    // Extract chunks
    const chunks = chunkBuffer.map(item => item.chunk);

    // Estimate tokens (rough estimation: 1 token ≈ 4 characters)
    const estimatedTokens = chunks.reduce((sum, chunk) => sum + Math.ceil(chunk.content.length / 4), 0);

    console.log(`🔄 Processing batch of ${chunks.length} chunks (~${estimatedTokens} tokens)`);
    await processChunkBatch(chunks, vectorDB);
}

async function processChunkBatch(chunks: CodeChunk[], vectorDB: MilvusVectorDB): Promise<void> {
    // Generate embedding vectors using batch processing
    const chunkContents = chunks.map(chunk => chunk.content);
    const embeddings: number[][] = await EmbeddingModel.embedBatch(chunkContents);

    // Add embeddings to chunks
    const chunksWithEmbeddings = chunks.map((chunk, index) => ({
        ...chunk,
        vector: embeddings[index]
    }));

    // Store to vector database
    await vectorDB.addChunks(chunksWithEmbeddings);
}

async function handleSearchCode(request: any, sendResponse: Function) {
    try {
        const { query, owner, repo } = request;
        const repoId = `${owner}/${repo}`;

        // Initialize Milvus
        const vectorDB = new MilvusVectorDB(repoId);
        await vectorDB.initialize();

        // Get query embedding using batch processing (single query)
        const queryEmbedding = await EmbeddingModel.embedSingle(query);

        // Search similar chunks
        const results = await vectorDB.searchSimilar(queryEmbedding, 20);

        await IndexedRepoManager.updateLastSearchTime(repoId);

        sendResponse({ success: true, results });
    } catch (error) {
        console.error('Search failed:', error);
        sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

async function handleClearIndex(request: any, sendResponse: Function) {
    try {
        const { owner, repo } = request;
        const repoId = `${owner}/${repo}`;

        const vectorDB = new MilvusVectorDB(repoId);
        await vectorDB.initialize();
        await vectorDB.clear();

        await IndexedRepoManager.removeIndexedRepo(repoId);

        sendResponse({ success: true, message: 'Index cleared successfully' });
    } catch (error) {
        console.error('Clear index failed:', error);
        sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

async function handleCheckIndexStatus(request: any, sendResponse: Function) {
    try {
        const { owner, repo } = request;
        const repoId = `${owner}/${repo}`;

        const indexedRepo = await IndexedRepoManager.isRepoIndexed(repoId);

        if (indexedRepo) {
            try {
                const vectorDB = new MilvusVectorDB(repoId);
                await vectorDB.initialize();
                const stats = await vectorDB.getStats();

                sendResponse({
                    success: true,
                    isIndexed: true,
                    indexInfo: indexedRepo,
                    stats
                });
            } catch (milvusError) {
                await IndexedRepoManager.removeIndexedRepo(repoId);
                sendResponse({
                    success: true,
                    isIndexed: false,
                    message: 'Index record found but collection missing, cleaned up storage'
                });
            }
        } else {
            sendResponse({
                success: true,
                isIndexed: false
            });
        }
    } catch (error) {
        console.error('Check index status failed:', error);
        sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

async function handleGetIndexedRepos(sendResponse: Function) {
    try {
        const repos = await IndexedRepoManager.getRecentlyIndexedRepos(20);
        sendResponse({
            success: true,
            repos
        });
    } catch (error) {
        console.error('Get indexed repos failed:', error);
        sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
