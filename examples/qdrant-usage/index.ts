import { Context, QdrantVectorDatabase, AstCodeSplitter, OpenAIEmbedding } from '@zilliz/claude-context-core';
import { envManager } from '@zilliz/claude-context-core';
import * as path from 'path';

// Try to load .env file
try {
    require('dotenv').config();
} catch (error) {
    // dotenv is not required, skip if not installed
}

async function main() {
    console.log('🚀 Claude Context with Qdrant Example');
    console.log('=====================================');

    try {
        // 1. Configure Qdrant Vector Database
        const qdrantUrl = envManager.get('QDRANT_URL') || 'http://localhost:6333';
        const qdrantApiKey = envManager.get('QDRANT_API_KEY');
        
        console.log(`🔌 Connecting to Qdrant at: ${qdrantUrl}`);
        
        const vectorDatabase = new QdrantVectorDatabase({
            url: qdrantUrl,
            ...(qdrantApiKey && { apiKey: qdrantApiKey })
        });

        // 2. Configure Embedding Provider
        const embedding = new OpenAIEmbedding({
            apiKey: envManager.get('OPENAI_API_KEY') || 'your-openai-api-key',
            model: 'text-embedding-3-small',
            ...(envManager.get('OPENAI_BASE_URL') && { baseURL: envManager.get('OPENAI_BASE_URL') })
        });

        // 3. Create Context instance
        const codeSplitter = new AstCodeSplitter(2500, 300);
        const context = new Context({
            embedding,
            vectorDatabase,
            codeSplitter,
            supportedExtensions: ['.ts', '.js', '.py', '.java', '.cpp', '.go', '.rs']
        });

        // 4. Index the codebase
        console.log('\n📖 Starting to index codebase...');
        const codebasePath = path.join(__dirname, '../..');

        // Check if index already exists and clear if needed
        const hasExistingIndex = await context.hasIndex(codebasePath);
        if (hasExistingIndex) {
            console.log('🗑️  Existing index found, clearing it first...');
            await context.clearIndex(codebasePath);
        }

        // Index with progress tracking
        const indexStats = await context.indexCodebase(codebasePath, (progress) => {
            console.log(`   Progress: ${progress.phase} - ${progress.percentage}% (${progress.current}/${progress.total} files)`);
        });

        // 5. Show indexing statistics
        console.log(`\n📊 Indexing completed!`);
        console.log(`   Files indexed: ${indexStats.indexedFiles}`);
        console.log(`   Code chunks: ${indexStats.totalChunks}`);
        console.log(`   Vector database: Qdrant`);

        // 6. Perform semantic searches
        console.log('\n🔍 Performing semantic searches...');

        const queries = [
            'Qdrant vector database implementation',
            'embedding generation functions',
            'code splitting and chunking',
            'typescript interface definitions',
            'error handling and logging'
        ];

        for (const query of queries) {
            console.log(`\n🔎 Search: "${query}"`);
            const results = await context.semanticSearch(codebasePath, query, 3, 0.3);

            if (results.length > 0) {
                results.forEach((result, index) => {
                    console.log(`   ${index + 1}. Similarity: ${(result.score * 100).toFixed(2)}%`);
                    console.log(`      File: ${result.relativePath}`);
                    console.log(`      Lines: ${result.startLine}-${result.endLine}`);
                    console.log(`      Preview: ${result.content.substring(0, 120)}...`);
                });
            } else {
                console.log('   No relevant results found');
            }
        }

        // 7. Demonstrate collection management
        console.log('\n📁 Collection management demo...');
        const collections = await vectorDatabase.listCollections();
        console.log(`   Available collections: ${collections.join(', ')}`);

        console.log('\n🎉 Qdrant example completed successfully!');
        console.log('\n💡 Key advantages of Qdrant:');
        console.log('   ✅ Simple deployment (single Docker container)');
        console.log('   ✅ Fast search performance (10-30ms latency)');
        console.log('   ✅ No external dependencies');

    } catch (error) {
        console.error('❌ Error occurred:', error);

        // Provide detailed error diagnostics
        if (error instanceof Error) {
            if (error.message.includes('API key')) {
                console.log('\n💡 Please set your OpenAI API key:');
                console.log('   export OPENAI_API_KEY="your-actual-api-key"');
            } else if (error.message.includes('connect') || error.message.includes('ECONNREFUSED')) {
                console.log('\n💡 Qdrant connection failed. Make sure Qdrant is running:');
                console.log('   Docker: docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant:latest');
                console.log('   Local:  qdrant --config-path ./qdrant-config.yaml');
            }

            console.log('\n🔧 Environment Variables:');
            console.log('   - OPENAI_API_KEY: Your OpenAI API key (required)');
            console.log('   - QDRANT_URL: Qdrant server URL (default: http://localhost:6333)');
            console.log('   - QDRANT_API_KEY: Qdrant API key (optional, for Qdrant Cloud)');
        }

        process.exit(1);
    }
}

// Run main program
if (require.main === module) {
    main().catch(console.error);
}

export { main };