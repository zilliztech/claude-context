import { Context, MilvusVectorDatabase, MilvusRestfulVectorDatabase, QdrantVectorDatabase, AstCodeSplitter, LangChainCodeSplitter } from '@zilliz/claude-context-core';
import { envManager } from '@zilliz/claude-context-core';
import * as path from 'path';

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
        const vectorDbType = envManager.get('VECTOR_DB_TYPE')?.toLowerCase() || 'milvus';
        const splitterType = envManager.get('SPLITTER_TYPE')?.toLowerCase() || 'ast';

        let vectorDatabase;
        
        if (vectorDbType === 'qdrant') {
            // Use Qdrant implementation (simple deployment)
            const qdrantUrl = envManager.get('QDRANT_URL') || 'http://localhost:6333';
            const qdrantApiKey = envManager.get('QDRANT_API_KEY');
            
            console.log(`🔧 Using Qdrant vector database`);
            console.log(`🔌 Connecting to Qdrant at: ${qdrantUrl}`);
            
            vectorDatabase = new QdrantVectorDatabase({
                url: qdrantUrl,
                ...(qdrantApiKey && { apiKey: qdrantApiKey })
            });
        } else {
            // Use Milvus implementation (default)
            const useRestfulApi = envManager.get('MILVUS_USE_RESTFUL')?.toLowerCase() === 'true';
            const milvusAddress = envManager.get('MILVUS_ADDRESS') || 'localhost:19530';
            const milvusToken = envManager.get('MILVUS_TOKEN');
            
            console.log(`🔧 Using Milvus ${useRestfulApi ? 'RESTful API' : 'gRPC'} implementation`);
            console.log(`🔌 Connecting to Milvus at: ${milvusAddress}`);

            if (useRestfulApi) {
                // Use RESTful implementation (for environments without gRPC support)
                vectorDatabase = new MilvusRestfulVectorDatabase({
                    address: milvusAddress,
                    ...(milvusToken && { token: milvusToken })
                });
            } else {
                // Use gRPC implementation (default, more efficient)
                vectorDatabase = new MilvusVectorDatabase({
                    address: milvusAddress,
                    ...(milvusToken && { token: milvusToken })
                });
            }
        }

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
            supportedExtensions: ['.ts', '.js', '.py', '.java', '.cpp', '.go', '.rs']
        });

        // 3. Check if index already exists and clear if needed
        console.log('\n📖 Starting to index codebase...');
        const codebasePath = path.join(__dirname, '../..'); // Index entire project

        // Check if index already exists
        const hasExistingIndex = await context.hasIndex(codebasePath);
        if (hasExistingIndex) {
            console.log('🗑️  Existing index found, clearing it first...');
            await context.clearIndex(codebasePath);
        }

        // Index with progress tracking
        const indexStats = await context.indexCodebase(codebasePath);

        // 4. Show indexing statistics
        console.log(`\n📊 Indexing stats: ${indexStats.indexedFiles} files, ${indexStats.totalChunks} code chunks`);

        // 5. Perform semantic search
        console.log('\n🔍 Performing semantic search...');

        const queries = [
            'vector database operations',
            'code splitting functions',
            'embedding generation',
            'typescript interface definitions'
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
                    console.log(`      Preview: ${result.content.substring(0, 100)}...`);
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
            } else if (error.message.includes('Milvus') || error.message.includes('Qdrant') || error.message.includes('connect')) {
                console.log('\n💡 Please make sure your vector database service is running');
                console.log('   Milvus:');
                console.log('   - Default address: localhost:19530');
                console.log('   - Start: docker run -p 19530:19530 milvusdb/milvus:latest');
                console.log('   Qdrant:');
                console.log('   - Default address: http://localhost:6333');
                console.log('   - Start: docker run -p 6333:6333 qdrant/qdrant:latest');
            }

            console.log('\n💡 Environment Variables:');
            console.log('   - OPENAI_API_KEY: Your OpenAI API key (required)');
            console.log('   - OPENAI_BASE_URL: Custom OpenAI API endpoint (optional)');
            console.log('   - VECTOR_DB_TYPE: Vector database type - "milvus" or "qdrant" (default: milvus)');
            console.log('   - MILVUS_ADDRESS: Milvus server address (default: localhost:19530)');
            console.log('   - MILVUS_TOKEN: Milvus authentication token (optional)');
            console.log('   - MILVUS_USE_RESTFUL: Use Milvus REST API instead of gRPC (default: false)');
            console.log('   - QDRANT_URL: Qdrant server URL (default: http://localhost:6333)');
            console.log('   - QDRANT_API_KEY: Qdrant API key (optional)');
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