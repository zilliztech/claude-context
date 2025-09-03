import { Context, MilvusVectorDatabase, MilvusRestfulVectorDatabase, AstCodeSplitter, LangChainCodeSplitter, ChromaConfig, ChromaVectorDatabase, AzureOpenAIEmbedding } from '@suoshengzhang/claude-context-core';
import { envManager } from '@suoshengzhang/claude-context-core';
import * as path from 'path';
import { ChromaClient } from "chromadb";

// Try to load .env file
try {
    require('dotenv').config();
} catch (error) {
    // dotenv is not required, skip if not installed
}

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

async function indexCodePathForRepo(codebasePath: string, ignorePatterns: string[]) {
    let host = 'localhost';
    let port = 19802;

    let vectorDatabase = new ChromaVectorDatabase({
        host: host,
        port: port
    });

    let embedding = new AzureOpenAIEmbedding({
        apiKey: '',
        model: 'text-embedding-3-large',
        endpoint: 'https://compassbotmodel01.openai.azure.com/',
        deploymentName: 'text-embedding-3-large',
        codeAgentEmbEndpoint: 'http://localhost:8000'
    });

    let context = new Context({
        embedding,
        vectorDatabase,
        // codeSplitter: new LangChainCodeSplitter(1000, 200),
        supportedExtensions: ['.cs', '.js', '.py', '.cpp', '.h'],
        ignorePatterns: ignorePatterns,
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

    const repoConfig = [
        {
            repoPath: "D:/src2/AdsSnR",
            ignorePatterns: [
                "packages/",
            ]
        },
        // {
        //     repoPath: "D:/src2/AdsSnR_IdHash",
        //     ignorePatterns: [
        //         "packages/",
        //     ]
        // },
        // {
        //     repoPath: "D:/src2/AdsInfra_DataServices",
        //     ignorePatterns: [
        //         "packages/",
        //     ]
        // }
    ];

    try {
        for (const repo of repoConfig) {
            await indexCodePathForRepo(repo.repoPath, repo.ignorePatterns);
        }
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
