import { Context, AstCodeSplitter, LangChainCodeSplitter, ChromaConfig, ChromaVectorDatabase, AzureOpenAIEmbedding } from '@suoshengzhang/claude-context-core';
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
        const results = await context.semanticSearch(query, codebasePath, 3, 0.3);

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

function shouldIgnoreFile(filePath: string): boolean {
    const relativePath = path.relative("D:/src/AdsSnR", filePath);
    console.log(relativePath);

    // Check ignore patterns
    // for (const pattern of this.options.ignorePatterns!) {
    // }
    if (matchesPattern(relativePath, "**/QLocal/**")) {
        return true;
    }

    return false;
}

function matchesPattern(filePath: string, pattern: string): boolean {
    // Convert pattern to regex
    const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
}

async function testSemanticSearch(codebasePath: string, query: string) {
    let host = 'localhost';
    let port = 19801;

    let vectorDatabase = new ChromaVectorDatabase({
        host: host,
        port: port
    });

    let codeAgentEndpoint = 'https://cppcodeanalyzer-efaxdbfzc2auexad.eastasia-01.azurewebsites.net/';
    let embedding = new AzureOpenAIEmbedding({
        codeAgentEmbEndpoint: codeAgentEndpoint
    });

    let context = new Context({
        embedding,
        vectorDatabase,
        codeAgentEndpoint: codeAgentEndpoint,
        // codeSplitter: new LangChainCodeSplitter(1000, 200),
    });

    let results = await context.semanticSearch(codebasePath, query, 3, 0.3, undefined, 'AdsSnR');
    console.log(results);
}


async function processReIndex(codebasePath: string) {
    let host = 'localhost';
    let port = 19801;
    let vectorDatabase = new ChromaVectorDatabase({
        host: host,
        port: port
    });
    let codeAgentEndpoint = 'https://cppcodeanalyzer-efaxdbfzc2auexad.eastasia-01.azurewebsites.net/';
    let embedding = new AzureOpenAIEmbedding({
        codeAgentEmbEndpoint: codeAgentEndpoint
    });
    let context = new Context({
        embedding,
        vectorDatabase,
        codeAgentEndpoint: codeAgentEndpoint,
    });

    const stats = await context.reindexByChange(codebasePath);
    console.log(stats);
}

async function testSplitCode(codeFilePath: string) {
    let codeSplitter = new AstCodeSplitter(2500, 300);
    let code = fs.readFileSync(codeFilePath, 'utf8');
    let language = "csharp";
    let chunks = await codeSplitter.split(code, language, codeFilePath);
    console.log(chunks);
}


async function main() {
    console.log('🚀 Context Real Usage Example');
    console.log('===============================');

    try {

        await processReIndex("D:/src/AdsSnR");

        // testSplitCode("D:/src/AdsSnR/private/De.Snr.Compass.Product/BackendWorker/Program.cs");

        // testSemanticSearch("D:/src/AdsSnR", "LocalDebugMode");

        // const filePath = "D:/src/AdsSnR/QLocal/cmd/z/CredScan_rolling.yaml";
        // console.log(shouldIgnoreFile(filePath));


        // Uncomment the line below to test ChromaDB iteration
        // let paths = await iterateAllChromaRecords('localhost', 19802);
        // console.log(paths);

        // monitorFileChanges("D:/src/simple_repo", DEFAULT_IGNORE_PATTERNS, true);

        // Keep process running to allow file monitoring
        // await new Promise(() => {}); // Never resolves, keeps process alive
        // testMatch();
        // return;

        // await indexCodePathForAdsSnr();
        // await searchCodePath(codebasePath, ["what is service override"]);

        console.log('\n🎉 Example completed successfully!');

    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Run main program
if (require.main === module) {
    main().catch(console.error);
}

export { main };
