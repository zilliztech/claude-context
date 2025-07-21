import { CodeContext } from '../packages/core/src/context';
import { OpenAIEmbedding } from '../packages/core/src/embedding/openai-embedding';
import { MilvusVectorDatabase } from '../packages/core/src/vectordb/milvus-vectordb';
import { AstCodeSplitter } from '../packages/core/src/splitter/ast-splitter';

/**
 * CodeContext End-to-End Test - Complete Workflow
 * Includes: Configure Embedding → Configure Vector Database → Create Context → Index Codebase → Semantic Search
 */
export async function testCodeContextEndToEnd(config: {
    openaiApiKey: string;
    milvusAddress: string;
    codebasePath: string;
    searchQuery: string;
}) {
    try {
        console.log('🚀 Starting CodeContext end-to-end test...');

        // 1. Create embedding instance
        console.log('📝 Creating OpenAI embedding instance...');
        const embedding = new OpenAIEmbedding({
            apiKey: config.openaiApiKey,
            model: 'text-embedding-3-small'
        });

        // 2. Create vector database instance
        console.log('🗄️ Creating Milvus vector database instance...');
        const vectorDB = new MilvusVectorDatabase({
            address: config.milvusAddress
        });

        // 3. Create CodeContext instance
        console.log('🔧 Creating CodeContext instance...');
        const codeSplitter = new AstCodeSplitter(1000, 200);
        const context = new CodeContext({
            embedding: embedding,
            vectorDatabase: vectorDB,
            codeSplitter: codeSplitter
        });

        // 4. Check if index already exists
        console.log('🔍 Checking existing index...');
        const hasIndex = await context.hasIndex(config.codebasePath);
        console.log(`Existing index status: ${hasIndex}`);

        // 5. Index codebase
        let indexStats;
        if (!hasIndex) {
            console.log('📚 Starting codebase indexing...');
            indexStats = await context.indexCodebase(config.codebasePath, (progress) => {
                console.log(`Indexing progress: ${progress.phase} - ${progress.percentage}%`);
            });
            console.log('✅ Indexing completed');
        } else {
            console.log('📖 Using existing index');
            indexStats = { indexedFiles: 0, totalChunks: 0, message: "Using existing index" };
        }

        // 6. Execute semantic search
        console.log('🔎 Executing semantic search...');
        const searchResults = await context.semanticSearch(
            config.codebasePath,
            config.searchQuery,
            5, // topK
            0.5 // threshold
        );

        // 7. Return complete results
        const result = {
            success: true,
            timestamp: new Date().toISOString(),
            config: {
                embeddingProvider: embedding.getProvider(),
                embeddingModel: 'text-embedding-3-small',
                embeddingDimension: embedding.getDimension(),
                vectorDatabase: 'Milvus',
                chunkSize: 1000,
                chunkOverlap: 200
            },
            indexStats: indexStats,
            searchQuery: config.searchQuery,
            searchResults: searchResults.map(result => ({
                relativePath: result.relativePath,
                startLine: result.startLine,
                endLine: result.endLine,
                language: result.language,
                score: result.score,
                contentPreview: result.content.substring(0, 200) + '...'
            })),
            summary: {
                indexedFiles: indexStats.indexedFiles || 0,
                totalChunks: indexStats.totalChunks || 0,
                foundResults: searchResults.length,
                avgScore: searchResults.length > 0 ?
                    searchResults.reduce((sum, r) => sum + r.score, 0) / searchResults.length : 0
            }
        };

        console.log('🎉 End-to-end test completed!');
        return result;

    } catch (error: any) {
        console.error('❌ End-to-end test failed:', error);
        return {
            success: false,
            timestamp: new Date().toISOString(),
            error: error.message,
            stack: error.stack
        };
    }
}

