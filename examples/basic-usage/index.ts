import { Context, MilvusVectorDatabase, MilvusRestfulVectorDatabase, AstCodeSplitter, LangChainCodeSplitter, ChromaConfig, ChromaVectorDatabase } from '@suoshengzhang/claude-context-core';
import { envManager } from '@suoshengzhang/claude-context-core';
import * as path from 'path';
import { ChromaClient } from "chromadb";

// Try to load .env file
try {
    require('dotenv').config();
} catch (error) {
    // dotenv is not required, skip if not installed
}

async function main() {
    console.log('🚀 Context Real Usage Example');
    console.log('===============================');

    try {
        // 1. Choose Vector Database implementation
        // Set to true to use RESTful API (for environments without gRPC support)
        // Set to false to use gRPC (default, more efficient)
        const chromaAddress = envManager.get('CHROMA_HOST') || 'localhost';
        const chromaPort = envManager.get('CHROMA_PORT') || 8000;
        const splitterType = envManager.get('SPLITTER_TYPE')?.toLowerCase() || 'ast';

        // envManager.set('CUSTOM_IGNORE_PATTERNS', '');
        envManager.set('CUSTOM_IGNORE_PATTERNS', 'AdsSnR_Common/**,AdsSnR_Idhash/**');

        console.log(`🔌 Connecting to Chroma at: ${chromaAddress}`);

        let client = new ChromaClient({
            host: chromaAddress,
            port: Number(chromaPort)
        });

        // let collection = await client.getCollection({
        //     name: 'hybrid_code_chunks_12bbd60e'
        // });

        // let filter = "";//JSON.stringify({ relativePath: "Services\\AcsDebugModeService.cs"});
        // const queryParams: any = {
        //     limit: 16384,
        //     include: ['documents', 'metadatas'] as any
        // };
        // if (filter) {
        //     queryParams.where = JSON.parse(filter);
        // }

        // let result = await collection.get(queryParams);

        // console.log(result);

        // return;

        let vectorDatabase = new ChromaVectorDatabase({
            host: chromaAddress,
            port: Number(chromaPort)
        });

        // 2. Create Context instance
        let codeSplitter;
        if (splitterType === 'langchain') {
            codeSplitter = new LangChainCodeSplitter(1000, 200);
        } else {
            codeSplitter = new AstCodeSplitter(2500, 300);
        }
        const context = new Context({
            vectorDatabase,
            codeSplitter,
            supportedExtensions: ['.cs', '.js', '.py', '.cpp', '.h']
        });

        // // 3. Check if index already exists and clear if needed
        // console.log('\n📖 Starting to index codebase...');
        // // const codebasePath = path.join(__dirname, './code'); // Index entire project
        const codebasePath = "d:/demos/test1"; //path.join(__dirname, '../..'); // Index entire project

        // // Check if index already exists
        // const hasExistingIndex = await context.hasIndex(codebasePath);
        // if (hasExistingIndex) {
        //     console.log('🗑️  Existing index found, clearing it first...');
        //     await context.clearIndex(codebasePath);
        // }

        // // Index with progress tracking
        // const indexStats = await context.indexCodebase(codebasePath);

        // // 4. Show indexing statistics
        // console.log(`\n📊 Indexing stats: ${indexStats.indexedFiles} files, ${indexStats.totalChunks} code chunks`);

        // 5. Perform semantic search
        console.log('\n🔍 Performing semantic search...');

        const queries = [
            'get me the detail of GetEnvToComps'
        ];

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
        }

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
