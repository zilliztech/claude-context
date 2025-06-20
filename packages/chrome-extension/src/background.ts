// OpenAI Embedding utilities
// The extension now relies on OpenAI's embeddings endpoint instead of a locally hosted model.

export {};

const EMBEDDING_DIM = 1536;
const MAX_TOKENS_PER_BATCH = 250000; // Conservative token limit per API request
const MAX_CHUNKS_PER_BATCH = 100; // Align with core logic

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

type EmbeddingFunction = (input: string | string[], options?: any) => Promise<{ data: number[] }>;

class EmbeddingModel {
    static instance: EmbeddingFunction | null = null;

    static async getInstance(_progress_callback: Function | undefined = undefined): Promise<EmbeddingFunction> {
        if (this.instance === null) {
            // Retrieve the OpenAI API key from extension storage.
            const apiKey: string | undefined = await new Promise((resolve, reject) => {
                chrome.storage.sync.get(['openaiToken'], (items) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(items.openaiToken as string | undefined);
                    }
                });
            });

            if (!apiKey) {
                throw new Error('OpenAI API key is not configured.');
            }

            // Define the embedding function that wraps the OpenAI embeddings endpoint.
            const embed: EmbeddingFunction = async (input: string | string[], _opts: any = {}): Promise<{ data: number[] }> => {
                const inputs = Array.isArray(input) ? input : [input];

                const response = await fetch('https://api.openai.com/v1/embeddings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: 'text-embedding-3-small',
                        input: inputs,
                    }),
                });

                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`OpenAI API error: ${response.status} - ${text}`);
                }

                const json = await response.json();
                const vectors: number[][] = json.data.map((d: any) => d.embedding as number[]);
                const flattened: number[] = ([] as number[]).concat(...vectors);
                return { data: flattened };
            };

            this.instance = embed;
        }

        return this.instance;
    }
}

class VectorDB {
    private dbName: string;
    private db: IDBDatabase | null;

    constructor(dbName = 'CodeVectorDB') {
        this.dbName = dbName;
        this.db = null;
    }

    async open(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                if (!this.db.objectStoreNames.contains('code_chunks')) {
                    const store = this.db.createObjectStore('code_chunks', { autoIncrement: true });
                    store.createIndex('repoId', 'repoId', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                resolve();
            };

            request.onerror = (event) => {
                reject('Error opening IndexedDB: ' + (event.target as IDBOpenDBRequest).error);
            };
        });
    }

    async addChunks(chunks: any[]): Promise<void> {
        if (!this.db) await this.open();
        const transaction = this.db!.transaction(['code_chunks'], 'readwrite');
        const store = transaction.objectStore('code_chunks');
        for (const chunk of chunks) {
            store.add(chunk);
        }
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject('Transaction error: ' + (event.target as IDBOpenDBRequest).error);
        });
    }

    async getAllChunks(repoId: string): Promise<any[]> {
        if (!this.db) await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(['code_chunks'], 'readonly');
            const store = transaction.objectStore('code_chunks');
            const index = store.index('repoId');
            const request = index.getAll(repoId);

            request.onsuccess = () => {
                resolve(request.result);
            };
            request.onerror = (event) => {
                reject('Error getting chunks: ' + (event.target as IDBOpenDBRequest).error);
            };
        });
    }

    async clearRepo(repoId: string): Promise<void> {
        if (!this.db) await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(['code_chunks'], 'readwrite');
            const store = transaction.objectStore('code_chunks');
            const index = store.index('repoId');
            const request = index.openKeyCursor(IDBKeyRange.only(repoId));

            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    store.delete(cursor.primaryKey);
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = (event) => reject('Error clearing repo: ' + (event.target as IDBOpenDBRequest).error);
        });
    }
}

class GitHubAPI {
    token: string;
    headers: { [key: string]: string };

    constructor(token: string) {
        this.token = token;
        this.headers = {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
        };
    }

    async getRepoTree(owner: string, repo: string, branch: string = 'main'): Promise<any[]> {
        const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        const response = await fetch(url, { headers: this.headers });
        if (!response.ok) {
            // If main branch fails, try master
            if (branch === 'main') {
                return this.getRepoTree(owner, repo, 'master');
            }
            throw new Error(`GitHub API error: ${response.status}`);
        }
        const data = await response.json();
        return data.tree.filter((file: any) => file.type === 'blob' && !file.path.includes('.git'));
    }

    async getFileContent(owner: string, repo: string, fileSha: string): Promise<string> {
        const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${fileSha}`;
        const response = await fetch(url, { headers: this.headers });
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }
        const data = await response.json();
        return atob(data.content);
    }
}

const db = new VectorDB();

// Mapping from tabId to repoId to track which repository was indexed in which tab.
const tabRepoMap: Record<number, string> = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_INDEXING') {
        if (sender.tab?.id) {
            const repoId = `${message.owner}/${message.repo}`;
            // Track the repo associated with this tab for later cleanup.
            tabRepoMap[sender.tab.id] = repoId;
            startIndexing(message.owner, message.repo, sender.tab.id);
        }
        return true;
    } else if (message.type === 'SEARCH') {
        // Wrap in try-catch to ensure we always send a response
        try {
            performSearch(message.owner, message.repo, message.query)
                .then(sendResponse)
                .catch(error => {
                    console.error('Search error:', error);
                    sendResponse([]);
                });
            return true; // Will respond asynchronously
        } catch (error) {
            console.error('Search error:', error);
            sendResponse([]);
            return false; // Responded synchronously
        }
    } else if (message.type === 'CHECK_INDEX_STATUS') {
        try {
            checkIndexStatus(message.repoId)
                .then(sendResponse)
                .catch(error => {
                    console.error('Check index status error:', error);
                    sendResponse(false);
                });
            return true; // Will respond asynchronously
        } catch (error) {
            console.error('Check index status error:', error);
            sendResponse(false);
            return false; // Responded synchronously
        }
    } else if (message.type === 'CLEAR_INDEX') {
        try {
            clearRepoIndex(message.repoId)
                .then(sendResponse)
                .catch(error => {
                    console.error('Clear index error:', error);
                    sendResponse(false);
                });
            return true; // Will respond asynchronously
        } catch (error) {
            console.error('Clear index error:', error);
            sendResponse(false);
            return false; // Responded synchronously
        }
    }
    return false;
});

/**
 * Batch chunks so that each batch's estimated token count does not exceed the limit.
 * @param chunks Array of string chunks
 * @param maxTokensPerBatch Maximum tokens per batch
 * @returns Array of chunk batches
 */
function batchChunksByTokenLimit(
    chunks: string[],
    maxTokensPerBatch: number,
    maxChunksPerBatch: number = MAX_CHUNKS_PER_BATCH
): string[][] {
    const batches: string[][] = [];
    let currentBatch: string[] = [];
    let currentTokens = 0;

    for (const chunk of chunks) {
        const estimatedTokens = Math.ceil(chunk.length / 4);

        const exceedsTokenLimit = currentTokens + estimatedTokens > maxTokensPerBatch;
        const exceedsChunkLimit = currentBatch.length >= maxChunksPerBatch;

        if (exceedsTokenLimit || exceedsChunkLimit) {
            if (currentBatch.length > 0) {
                batches.push(currentBatch);
                currentBatch = [];
                currentTokens = 0;
            }
        }

        currentBatch.push(chunk);
        currentTokens += estimatedTokens;
    }

    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }

    return batches;
}

async function sendTabMessage(tabId: number, message: any): Promise<void> {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab) {
            console.warn(`Tab ${tabId} does not exist`);
            return;
        }
        
        await chrome.tabs.sendMessage(tabId, message).catch(error => {
            console.warn(`Failed to send message to tab ${tabId}:`, error);
        });
    } catch (error) {
        console.warn(`Error checking tab ${tabId}:`, error);
    }
}

async function startIndexing(owner: string, repo: string, tabId: number) {
    const repoId = `${owner}/${repo}`;
    console.log(`Starting indexing for ${repoId}`);

    try {
        const { githubToken, chunkSize, chunkOverlap } = await new Promise<{ githubToken?: string; chunkSize?: number; chunkOverlap?: number }>((resolve) => {
            chrome.storage.sync.get(['githubToken', 'chunkSize', 'chunkOverlap'], (items) => resolve(items));
        });

        const effectiveChunkSize = typeof chunkSize === 'number' ? chunkSize : 1000;
        const effectiveChunkOverlap = typeof chunkOverlap === 'number' ? chunkOverlap : 200;

        if (!githubToken) {
            throw new Error('GitHub token not set.');
        }

        const github = new GitHubAPI(githubToken);
        const files = await github.getRepoTree(owner, repo);

        // Exclude non-code files such as documentation, images, audio, and video assets
        const excludedExtensions = [
            '.md', '.markdown',
            // Image formats
            '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.svg',
            // Audio formats
            '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma',
            // Video formats
            '.mp4', '.mkv', '.mov', '.avi', '.webm', '.flv', '.wmv', '.mpeg', '.mpg'
        ];

        const codeFiles = files.filter((file: any) => {
            const lowerPath = file.path.toLowerCase();
            return !excludedExtensions.some(ext => lowerPath.endsWith(ext));
        });

        await db.clearRepo(repoId);

        const model = await EmbeddingModel.getInstance();

        const totalFiles = codeFiles.length;
        let processedFiles = 0;
        const startTime = performance.now();

        for (const file of codeFiles) {
            try {
                const content = await github.getFileContent(owner, repo, file.sha);
                // Split file into textual chunks
                const rawChunks = chunkText(content, effectiveChunkSize, effectiveChunkOverlap);

                // Remove chunks that are empty or contain only whitespace
                const chunks = rawChunks.filter((c) => c.trim().length > 0);

                if (chunks.length === 0) {
                    continue; // Skip files that yield no meaningful chunks
                }

                // Embed in batches that respect both token and chunk count limits
                const chunkBatches = batchChunksByTokenLimit(chunks, MAX_TOKENS_PER_BATCH);
                let allEmbeddings: number[] = [];
                for (const batch of chunkBatches) {
                    const embeddings = await model(batch);
                    allEmbeddings = allEmbeddings.concat(embeddings.data);
                }

                const chunkData = chunks.map((chunk, i) => ({
                    repoId,
                    file_path: file.path,
                    chunk,
                    embedding: Array.from(allEmbeddings.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM))
                }));

                await db.addChunks(chunkData);

            } catch (error) {
                console.error(`Error processing file ${file.path}:`, error);
            }
            processedFiles++;
            await sendTabMessage(tabId, { 
                type: 'INDEXING_PROGRESS', 
                progress: processedFiles, 
                total: totalFiles 
            });
        }
        
        const duration = ((performance.now() - startTime) / 1000).toFixed(2);
        await sendTabMessage(tabId, { 
            type: 'INDEXING_COMPLETE', 
            duration 
        });

    } catch (error: any) {
        console.error('Indexing failed:', error);
        await sendTabMessage(tabId, { 
            type: 'INDEXING_COMPLETE', 
            error: error.message 
        });
    }
}

async function performSearch(owner: string, repo: string, query: string): Promise<any[]> {
    const repoId = `${owner}/${repo}`;
    console.log(`Searching for "${query}" in ${repoId}`);

    try {
        const model = await EmbeddingModel.getInstance();
        const queryEmbedding = await model(query);

        const allChunks = await db.getAllChunks(repoId);

        if (allChunks.length === 0) {
            return [];
        }

        const results = allChunks.map(chunk => {
            const similarity = cosSim(Array.from(queryEmbedding.data), chunk.embedding);
            return { ...chunk, similarity };
        });

        results.sort((a, b) => b.similarity - a.similarity);

        return results.slice(0, 10);

    } catch (error) {
        console.error('Search failed:', error);
        return [];
    }
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
    // Clamp overlap to be less than chunkSize to avoid infinite loops
    const safeOverlap = Math.min(overlap, chunkSize - 1);

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        const chunk = text.slice(start, end);
        chunks.push(chunk);

        // Move the window forward while keeping the desired overlap
        start += chunkSize - safeOverlap;
    }

    return chunks;
}

// Clean up stored embeddings when the user closes the tab that initiated indexing.
chrome.tabs.onRemoved.addListener((tabId) => {
    const repoId = tabRepoMap[tabId];
    if (repoId) {
        db.clearRepo(repoId).catch((err) => {
            console.error('Error clearing repo on tab close:', err);
        });
        delete tabRepoMap[tabId];
    }
});

async function checkIndexStatus(repoId: string): Promise<boolean> {
    try {
        const chunks = await db.getAllChunks(repoId);
        return chunks.length > 0;
    } catch (error) {
        console.error('Error checking index status:', error);
        return false;
    }
}

async function clearRepoIndex(repoId: string): Promise<boolean> {
    try {
        await db.clearRepo(repoId);
        return true;
    } catch (error) {
        console.error('Error clearing index:', error);
        return false;
    }
} 