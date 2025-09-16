import { Context, MilvusVectorDatabase, MilvusRestfulVectorDatabase, PostgresVectorDatabase, AstCodeSplitter, LangChainCodeSplitter, OllamaEmbedding, OpenAIEmbedding } from '@zilliz/claude-context-core';
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
        const vectorDbProvider = envManager.get('VECTOR_DATABASE_PROVIDER')?.toLowerCase() || 'milvus';
        const useRestfulApi = envManager.get('MILVUS_USE_RESTFUL') === 'true';
        const splitterType = envManager.get('SPLITTER_TYPE')?.toLowerCase() || 'ast';

        console.log(`🔧 Using vector database provider: ${vectorDbProvider}`);

        let vectorDatabase;
        if (vectorDbProvider === 'postgres') {
            // Use PostgreSQL with pgvector
            const postgresConfig = {
                connectionString: envManager.get('POSTGRES_CONNECTION_STRING'),
                host: envManager.get('POSTGRES_HOST') || 'localhost',
                port: envManager.get('POSTGRES_PORT') ? parseInt(envManager.get('POSTGRES_PORT')!) : 5432,
                database: envManager.get('POSTGRES_DATABASE') || 'postgres',
                username: envManager.get('POSTGRES_USERNAME') || 'postgres',
                password: envManager.get('POSTGRES_PASSWORD'),
                ssl: envManager.get('POSTGRES_SSL') === 'true'
            };

            console.log(`🔌 Connecting to PostgreSQL at: ${postgresConfig.connectionString || `${postgresConfig.host}:${postgresConfig.port}/${postgresConfig.database}`}`);
            vectorDatabase = new PostgresVectorDatabase(postgresConfig);
        } else {
            // Use Milvus (default)
            const milvusAddress = envManager.get('MILVUS_ADDRESS') || 'localhost:19530';
            const milvusToken = envManager.get('MILVUS_TOKEN');

            console.log(`🔧 Using ${useRestfulApi ? 'RESTful API' : 'gRPC'} implementation`);
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

        console.log('🔧 Using embedding provider: ', envManager.get('EMBEDDING_PROVIDER'));
        let embedding;
        const embeddingProvider = envManager.get('EMBEDDING_PROVIDER')?.toLowerCase() || 'openai';
        if (embeddingProvider === 'ollama') {
            console.log('🔧 Using Ollama embedding provider');
            embedding = new OllamaEmbedding({
                host: envManager.get('OLLAMA_HOST') || 'http://127.0.0.1:11434',
                model: envManager.get('EMBEDDING_MODEL') || 'all-minilm'
            });
        } else {
            embedding = new OpenAIEmbedding({
                model: 'text-embedding-3-small',
                apiKey: envManager.get('OPENAI_API_KEY') || 'your-openai-api-key',
                baseURL: envManager.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1'
            });
        }

        const context = new Context({
            embedding,
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
            console.log('   - VECTOR_DATABASE_PROVIDER: Vector database provider - "milvus" or "postgres" (default: milvus)');
            console.log('   - MILVUS_ADDRESS: Milvus server address (default: localhost:19530)');
            console.log('   - MILVUS_TOKEN: Milvus authentication token (optional)');
            console.log('   - MILVUS_USE_RESTFUL: Use Milvus REST API instead of gRPC (true/false, default: false)');
            console.log('   - POSTGRES_CONNECTION_STRING: PostgreSQL connection string (e.g., postgresql://user:pass@localhost:5432/db)');
            console.log('   - POSTGRES_HOST: PostgreSQL host (default: localhost)');
            console.log('   - POSTGRES_PORT: PostgreSQL port (default: 5432)');
            console.log('   - POSTGRES_DATABASE: PostgreSQL database name (default: postgres)');
            console.log('   - POSTGRES_USERNAME: PostgreSQL username (default: postgres)');
            console.log('   - POSTGRES_PASSWORD: PostgreSQL password');
            console.log('   - POSTGRES_SSL: Enable SSL connection (true/false, default: false)');
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