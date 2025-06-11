import { CodeIndexer } from '@code-indexer/core';
import * as path from 'path';

// Try to load .env file
try {
    require('dotenv').config();
} catch (error) {
    // dotenv is not required, skip if not installed
}

async function main() {
    console.log('🚀 CodeIndexer Real Usage Example');
    console.log('===============================');

    try {
        // 1. Create CodeIndexer instance
        const indexer = new CodeIndexer({
            chunkSize: 1000,
            chunkOverlap: 200,
            // Can customize supported file extensions
            supportedExtensions: ['.ts', '.js', '.py', '.java', '.cpp']
        });

        // 2. Index codebase
        console.log('\n📖 Starting to index codebase...');
        const codebasePath = path.join(__dirname, '../..'); // Index entire project

        // Index with progress tracking
        const indexStats = await indexer.indexCodebase(codebasePath);

        // 3. Show indexing statistics
        console.log(`\n📊 Indexing stats: ${indexStats.indexedFiles} files, ${indexStats.totalChunks} code chunks`);

        // 4. Perform semantic search
        console.log('\n🔍 Performing semantic search...');

        const queries = [
            'vector database operations',
            'code splitting functions',
            'embedding generation',
            'typescript interface definitions'
        ];

        for (const query of queries) {
            console.log(`\n🔎 Search: "${query}"`);
            const results = await indexer.semanticSearch(codebasePath, query, 3, 0.3);

            if (results.length > 0) {
                results.forEach((result, index) => {
                    console.log(`   ${index + 1}. Similarity: ${(result.score * 100).toFixed(2)}%`);
                    console.log(`      File: ${result.filePath}`);
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
            } else if (error.message.includes('Milvus') || error.message.includes('connect')) {
                console.log('\n💡 Please make sure Milvus service is running');
                console.log('   - Default address: localhost:19530');
                console.log('   - Can be modified via MILVUS_ADDRESS environment variable');
                console.log('   - Start Milvus: docker run -p 19530:19530 milvusdb/milvus:latest');
            }
        }

        process.exit(1);
    }
}

// Run main program
if (require.main === module) {
    main().catch(console.error);
}

export { main }; 