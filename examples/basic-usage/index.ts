import { Context, MilvusVectorDatabase, MilvusRestfulVectorDatabase, AstCodeSplitter, LangChainCodeSplitter, ChromaConfig, ChromaVectorDatabase } from '@suoshengzhang/claude-context-core';
import { envManager } from '@suoshengzhang/claude-context-core';
import * as path from 'path';
import { ChromaClient } from "chromadb";
import * as fs from 'fs';

// Try to load .env file
try {
    require('dotenv').config();
} catch (error) {
    // dotenv is not required, skip if not installed
}

const DEFAULT_IGNORE_PATTERNS = [
    // Common build output and dependency directories
    'node_modules/**',
    'dist/',
    'build/',
    'obj/',
    'Logs/',
    'QLogs/',
    'QLocal/',
    'objd/',
    'out/',
    'target/',
    'coverage/',
    'packages/',
    '.corext/',
    '**.nyc_output/**',
    '.azuredevops/**',
    '.config/**',

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
    'node_modules', '.git', '.svn', '.hg', 'build', 'dist', 'out',
    'target', '.vscode', '.idea', '__pycache__', '.pytest_cache',
    'coverage', '.nyc_output', 'logs', 'tmp', 'temp',
    '.editorconfig',
    '.gitattributes'
];

/**
 * Generate a snapshot file for the given codebase directory
 * @param rootDir Absolute path to codebase directory
 * @param ignorePatterns Optional array of glob patterns to ignore
 * @returns Promise that resolves when snapshot is generated
 */
async function generateSnapshot(rootDir: string, ignorePatterns: string[] = []): Promise<void> {
    try {
        console.log(`Generating snapshot for codebase: ${rootDir}`);
        
        // Create synchronizer instance with provided ignore patterns
        const { FileSynchronizer } = await import('@suoshengzhang/claude-context-core');
        const synchronizer = new FileSynchronizer(rootDir, ignorePatterns);

        // Initialize will generate initial hashes and save snapshot
        await synchronizer.initialize();

        console.log('✅ Snapshot generated successfully');
    } catch (error: any) {
        console.error('Failed to generate snapshot:', error.message);
        throw error;
    }
}

/**
 * Get the Git repository name from a folder path by looking for the .git directory
 * and reading the remote origin URL from the git config
 * @param folderPath Path to folder to check
 * @returns Repository name or null if not a git repo
 */
async function getGitRepoName(folderPath: string): Promise<string | null> {
    try {
        const fs = require('fs');
        const path = require('path');

        // Walk up directory tree looking for .git folder
        let currentPath = folderPath;
        let gitDir = null;
        
        while (currentPath !== path.parse(currentPath).root) {
            const potentialGitDir = path.join(currentPath, '.git');
            if (fs.existsSync(potentialGitDir)) {
                gitDir = potentialGitDir;
                break;
            }
            currentPath = path.dirname(currentPath);
        }

        if (!gitDir) {
            return null;
        }

        // Read config file to get remote origin URL
        const configPath = path.join(gitDir, 'config');
        const config = fs.readFileSync(configPath, 'utf8');

        // Extract remote origin URL using regex
        const originUrlMatch = config.match(/\[remote "origin"\][\s\S]*?url = (.+)/);
        if (!originUrlMatch) {
            return null;
        }

        const originUrl = originUrlMatch[1].trim();

        // Extract repo name from URL
        const repoNameMatch = originUrl.match(/\/([^\/]+?)(\.git)?$/);
        if (!repoNameMatch) {
            return null;
        }

        return repoNameMatch[1];

    } catch (error) {
        console.error('Error getting git repo name:', error);
        return null;
    }
}

/**
 * Monitor file changes in a given folder, ignoring files that match ignore patterns
 * @param folderPath Path to the folder to monitor
 * @param ignorePatterns Array of glob patterns to ignore
 * @param recursive Whether to monitor subdirectories recursively
 */
function monitorFileChanges(folderPath: string, ignorePatterns: string[] = [], recursive: boolean = true): void {
    console.log(`🔍 Starting file monitoring for: ${folderPath}`);
    console.log(`📝 Ignore patterns: ${ignorePatterns.join(', ')}`);
    console.log(`🔄 Recursive monitoring: ${recursive ? 'enabled' : 'disabled'}`);
    console.log('⏳ Waiting for file changes... (Press Ctrl+C to stop)\n');

    // Function to check if a file should be ignored
    function shouldIgnoreFile(filePath: string): boolean {
        const relativePath = path.relative(folderPath, filePath);
        const normalizedPath = relativePath.replace(/\\/g, '/'); // Normalize path separators
        
        for (const pattern of ignorePatterns) {
            if (isPatternMatch(normalizedPath, pattern)) {
                return true;
            }
        }
        return false;
    }

    // Function to handle file change events
    function handleFileChange(eventType: string, filename: string | null, filePath?: string) {
        if (!filename) return;
        
        const fullPath = filePath || path.join(folderPath, filename);
        
        // Check if file should be ignored
        if (shouldIgnoreFile(fullPath)) {
            return; // Skip ignored files
        }

        // Get file stats to determine if it's a file or directory
        try {
            const stats = fs.statSync(fullPath);
            const isDirectory = stats.isDirectory();
            const fileType = isDirectory ? '📁 Directory' : '📄 File';
            
            console.log(`[${new Date().toLocaleTimeString()}] ${eventType.toUpperCase()}: ${fileType}`);
            console.log(`   Path: ${fullPath}`);
            console.log(`   Size: ${isDirectory ? 'N/A' : `${(stats.size / 1024).toFixed(2)} KB`}`);
            console.log(`   Modified: ${stats.mtime.toLocaleString()}`);
            console.log(''); // Empty line for readability
        } catch (error) {
            // File might have been deleted or moved
            console.log(`[${new Date().toLocaleTimeString()}] ${eventType.toUpperCase()}: ${fullPath}`);
            console.log(`   Status: File may have been deleted or moved`);
            console.log(''); // Empty line for readability
        }
    }

    try {
        // Start watching the main directory
        const watcher = fs.watch(folderPath, { recursive }, (eventType, filename) => {
            handleFileChange(eventType, filename);
        });

        // Handle watcher errors
        watcher.on('error', (error) => {
            console.error('❌ File watcher error:', error);
        });

        // Handle process termination
        process.on('SIGINT', () => {
            console.log('\n🛑 Stopping file monitoring...');
            watcher.close();
            process.exit(0);
        });

        console.log('✅ File monitoring started successfully');
        
    } catch (error) {
        console.error('❌ Failed to start file monitoring:', error);
    }
}

async function searchCodePath(codebasePath: string, queries: string[]) {
    let host = 'localhost';
    let port = 19801;

    let vectorDatabase = new ChromaVectorDatabase({
        host: host,
        port: port
    });

    let context = new Context({
        vectorDatabase,
        codeSplitter: new LangChainCodeSplitter(1000, 200),
        supportedExtensions: ['.cs', '.js', '.py', '.cpp', '.h']
    });

    for (const query of queries) {
        console.log(`\n🔎 Search: "${query}"`);
        const results = await context.semanticSearch(codebasePath, query, 3, 0.3);

        if (results.length > 0) {
            results.forEach((result, index) => {
                console.log(`   ${index + 1}. Similarity: ${(result.score * 100).toFixed(2)}%`);
                console.log(`      File: ${path.join(codebasePath, result.relativePath)}`);
                console.log(`      Language: ${result.language}`);
                console.log(`      Lines: ${result.startLine}-${result.endLine}`);
                console.log(`      Preview: ${result.content}...`);
            });
        } else {
            console.log('   No relevant results found');
        }

        console.log(results);
    }

}


function isPatternMatch(filePath: string, pattern: string): boolean {
    // Handle directory patterns (ending with /)
    if (pattern.endsWith('/')) {
        const dirPattern = pattern.slice(0, -1);
        const pathParts = filePath.split('/');
        return pathParts.some(part => simpleGlobMatch(part, dirPattern));
    }

    // Handle file patterns
    if (pattern.includes('/')) {
        // Pattern with path separator - match exact path
        return simpleGlobMatch(filePath, pattern);
    } else {
        // Pattern without path separator - match filename in any directory
        const fileName = path.basename(filePath);
        return simpleGlobMatch(fileName, pattern);
    }
}

function simpleGlobMatch(text: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
        .replace(/\*/g, '.*'); // Convert * to .*

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
}

function matchesIgnorePattern(filePath: string, basePath: string): boolean {
    const relativePath = path.relative(basePath, filePath);
    const normalizedPath = relativePath.replace(/\\/g, '/'); // Normalize path separators

    let ignorePatterns = [
        "obj/"
    ];
    for (const pattern of ignorePatterns) {
        if (isPatternMatch(normalizedPath, pattern)) {
            return true;
        }
    }

    return false;
}

function testMatch() {
    let basePath = "D:/src/AdsSnR/private/";
    let filePath = "D:/src/AdsSnR/private/De.Snr.Compass.Product/test/BackendWorker/obj/src/test/aaa.cs";

    if (matchesIgnorePattern(filePath, basePath)) {
        console.log("match");
    } else {
        console.log("not match");
    }
}

/**
 * Iterate through all records in ChromaDB and measure total time
 * @param host ChromaDB host (default: localhost)
 * @param port ChromaDB port (default: 19801)
 * @returns Promise that resolves when iteration is complete
 */
async function iterateAllChromaRecords(host: string = 'localhost', port: number = 19801): Promise<string[]> {
    const startTime = Date.now();
    let relativeFilePaths: Set<string> = new Set();
    
    try {
        // Create ChromaDB client directly to access ChromaDB API
        const client = new ChromaClient({
            host: host,
            port: port
        });

        // Get all collections - ChromaDB doesn't have a direct listCollections method
        // We'll need to work with known collection names or create a workaround
        console.log('📚 Attempting to fetch collections...');
        
        let totalRecords = 0;
        let collectionName = 'code_chunks_AdsSnR';
        const collectionStartTime = Date.now();
        
        try {
            // Try to get the collection
            const collection = await client.getCollection({
                name: collectionName,
            });

            if (!collection) {
                console.log(`⚠️ Collection ${collectionName} not found, skipping...`);
                return [];
            }

            // Get collection count
            const count = await collection.count();
            console.log(`📊 Collection size: ${count} records`);

            if (count === 0) {
                console.log(`⚠️ Collection ${collectionName} has no records, skipping...`);
                return [];
            }

            // Iterate through all records in batches
            const batchSize = 1024;
            let processedRecords = 0;
            let offset = 0;

            while (processedRecords < count) {
                const batch = await collection.get({
                    limit: batchSize,
                    include: ['documents', 'metadatas'] as any,
                    offset: offset
                });

                const records = batch.rows();
                records.forEach((record: any) => {
                    let relativePath = record.metadata?.relativePath;
                    if (relativePath && !relativeFilePaths.has(relativePath)) {
                        relativeFilePaths.add(relativePath);
                    }
                });

                if (batch && batch.ids && batch.ids.length > 0) {
                    processedRecords += batch.ids.length;
                    offset += batch.ids.length;
                } else {
                    break; // No more records
                }
            }

            totalRecords += count;

            const collectionTime = Date.now() - collectionStartTime;
            console.log(`   ✅ Collection ${collectionName} processed in ${collectionTime}ms`);

        } catch (error) {
            console.log(`   ⚠️  Collection ${collectionName} not found or not accessible:`, error.message);
        }

        
        const totalTime = Date.now() - startTime;
        console.log(`\n🎉 ChromaDB iteration completed!`);
        console.log(`📊 Summary:`);
        console.log(`   Total records: ${totalRecords}`);
        console.log(`   Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
        
        // Convert Set to array and return all collected file paths
        const filePaths = Array.from(relativeFilePaths);
        return filePaths;

    } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error(`❌ Error during ChromaDB iteration after ${totalTime}ms:`, error);
        throw error;
    }
}


async function indexCodePathForAdsSnr() {
    let codebasePath = "D:/src/simple_repo";
    let host = 'localhost';
    let port = 19802;

    let vectorDatabase = new ChromaVectorDatabase({
        host: host,
        port: port
    });

    let context = new Context({
        vectorDatabase,
        codeSplitter: new LangChainCodeSplitter(1000, 200),
        supportedExtensions: ['.cs', '.js', '.py', '.cpp', '.h'],
        ignorePatterns: [
            // for AdsSnR Test
            'AdsSnR_RocksDB/',
            'AdsSnR_PClick/',
            'AdsSnR_FeatureExtraction/',
            'AdsSnR_Selection/',
            'AdsSnR_Common/',
            'AdsSnR_IdHash/',
            'packages/',
            '.github/',
            'AI/**',
        ]
    });

    const hasExistingIndex = await context.hasIndex(codebasePath);
    if (hasExistingIndex) {
        console.log('🗑️  Existing index found, clearing it first...');
        await context.clearIndex(codebasePath);
    }

    // // Index with progress tracking
    const indexStats = await context.indexCodebase(codebasePath);
    console.log(`🔍 Indexed ${indexStats.indexedFiles} files, ${indexStats.totalChunks} code chunks`);

    await generateSnapshot(codebasePath, context.getIgnorePatterns());
    console.log('✅ Snapshot generated successfully');
}

async function main() {
    console.log('🚀 Context Real Usage Example');
    console.log('===============================');

    try {

        // Uncomment the line below to test ChromaDB iteration
        // let paths = await iterateAllChromaRecords('localhost', 19802);
        // console.log(paths);

        // monitorFileChanges("D:/src/simple_repo", DEFAULT_IGNORE_PATTERNS, true);

        // Keep process running to allow file monitoring
        // await new Promise(() => {}); // Never resolves, keeps process alive
        // testMatch();
        // return;

        await indexCodePathForAdsSnr();
        // await searchCodePath(codebasePath, ["what is service override"]);

        console.log('\n🎉 Example completed successfully!');

    } catch (error) {
        console.error('❌ Error occurred:', error);

        // Provide detailed error diagnostics
        if (error instanceof Error) {
            if (error.message.includes('API key')) {
                console.log('\n💡 Please make sure to set the correct OPENAI_API_KEY environment variable');
                console.log('   Example: export OPENAI_API_KEY="your-actual-api-key"');
            } else if (error.message.includes('Milvus') || error.message.includes('connect')) {
                console.log('\n💡 Please make sure Milvus service is running');
                console.log('   - Default address: localhost:19530');
                console.log('   - Can be modified via MILVUS_ADDRESS environment variable');
                console.log('   - For RESTful API: set MILVUS_USE_RESTFUL=true');
                console.log('   - For gRPC (default): set MILVUS_USE_RESTFUL=false or leave unset');
                console.log('   - Start Milvus: docker run -p 19530:19530 milvusdb/milvus:latest');
            }

            console.log('\n💡 Environment Variables:');
            console.log('   - OPENAI_API_KEY: Your OpenAI API key (required)');
            console.log('   - OPENAI_BASE_URL: Custom OpenAI API endpoint (optional)');
            console.log('   - MILVUS_ADDRESS: Milvus server address (default: localhost:19530)');
            console.log('   - MILVUS_TOKEN: Milvus authentication token (optional)');
            console.log('   - SPLITTER_TYPE: Code splitter type - "ast" or "langchain" (default: ast)');
        }

        process.exit(1);
    }
}

// Run main program
if (require.main === module) {
    main().catch(console.error);
}

export { main };
