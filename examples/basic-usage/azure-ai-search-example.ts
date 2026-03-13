import { AzureAISearchVectorDatabase, AzureAISearchConfig } from './azure-ai-search-vectordb';
import { VectorDocument, SearchOptions, HybridSearchRequest } from './types';

/**
 * Example usage of Azure AI Search Vector Database
 * This file demonstrates common use cases and patterns
 */

// ============================================================================
// Configuration and Initialization
// ============================================================================

async function initializeDatabase(): Promise<AzureAISearchVectorDatabase> {
    const config: AzureAISearchConfig = {
        endpoint: process.env.AZURE_SEARCH_ENDPOINT || 'https://your-service.search.windows.net',
        apiKey: process.env.AZURE_SEARCH_API_KEY || 'your-api-key',
        batchSize: 100,
        maxRetries: 3,
        retryDelayMs: 1000,
    };

    const vectorDb = new AzureAISearchVectorDatabase(config);

    console.log('✅ Azure AI Search Vector Database initialized');
    return vectorDb;
}

// ============================================================================
// Example 1: Basic Vector Search for Code
// ============================================================================

async function example1_BasicVectorSearch() {
    console.log('\n' + '='.repeat(80));
    console.log('Example 1: Basic Vector Search for Code Snippets');
    console.log('='.repeat(80));

    const vectorDb = await initializeDatabase();

    try {
        // Create collection
        const collectionName = 'code-snippets';
        const dimension = 1536; // OpenAI ada-002 dimension

        await vectorDb.createCollection(collectionName, dimension, 'Code snippet embeddings');

        // Sample documents (in real scenario, vectors would come from an embedding model)
        const documents: VectorDocument[] = [
            {
                id: 'snippet-1',
                vector: Array(dimension).fill(0).map(() => Math.random()),
                content: 'async function fetchUserData(userId) { const response = await fetch(`/api/users/${userId}`); return response.json(); }',
                relativePath: 'src/services/userService.ts',
                startLine: 15,
                endLine: 19,
                fileExtension: 'ts',
                metadata: {
                    language: 'typescript',
                    complexity: 'medium',
                    author: 'jane.doe',
                    tags: ['async', 'api', 'fetch']
                }
            },
            {
                id: 'snippet-2',
                vector: Array(dimension).fill(0).map(() => Math.random()),
                content: 'function validateEmail(email) { const regex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/; return regex.test(email); }',
                relativePath: 'src/utils/validators.js',
                startLine: 23,
                endLine: 26,
                fileExtension: 'js',
                metadata: {
                    language: 'javascript',
                    complexity: 'low',
                    author: 'john.smith',
                    tags: ['validation', 'regex', 'email']
                }
            },
            {
                id: 'snippet-3',
                vector: Array(dimension).fill(0).map(() => Math.random()),
                content: 'class DatabaseConnection { constructor(config) { this.pool = createPool(config); } async query(sql, params) { const client = await this.pool.connect(); try { return await client.query(sql, params); } finally { client.release(); } } }',
                relativePath: 'src/database/connection.ts',
                startLine: 8,
                endLine: 20,
                fileExtension: 'ts',
                metadata: {
                    language: 'typescript',
                    complexity: 'high',
                    author: 'jane.doe',
                    tags: ['database', 'pool', 'async']
                }
            }
        ];

        // Insert documents
        await vectorDb.insert(collectionName, documents);

        // Perform vector search
        const queryVector = Array(dimension).fill(0).map(() => Math.random());
        const searchOptions: SearchOptions = {
            topK: 2,
            threshold: 0.0,
            filterExpr: "fileExtension eq 'ts'"
        };

        const results = await vectorDb.search(collectionName, queryVector, searchOptions);

        console.log(`\n📊 Search Results (found ${results.length} matches):`);
        results.forEach((result, index) => {
            console.log(`\n  Result ${index + 1}:`);
            console.log(`    Score: ${result.score.toFixed(4)}`);
            console.log(`    File: ${result.document.relativePath}`);
            console.log(`    Lines: ${result.document.startLine}-${result.document.endLine}`);
            console.log(`    Content: ${result.document.content.substring(0, 80)}...`);
            console.log(`    Tags: ${result.document.metadata.tags.join(', ')}`);
        });

        // Cleanup
        await vectorDb.dropCollection(collectionName);
        console.log('\n✅ Example 1 completed successfully');
    } catch (error) {
        console.error('❌ Error in Example 1:', error);
    } finally {
        await vectorDb.close();
    }
}

// ============================================================================
// Example 2: Hybrid Search with Filtering
// ============================================================================

async function example2_HybridSearch() {
    console.log('\n' + '='.repeat(80));
    console.log('Example 2: Hybrid Search with Vector and Text');
    console.log('='.repeat(80));

    const vectorDb = await initializeDatabase();

    try {
        const collectionName = 'documentation';
        const dimension = 768; // Smaller dimension for example

        await vectorDb.createHybridCollection(collectionName, dimension, 'Documentation with hybrid search');

        const documents: VectorDocument[] = [
            {
                id: 'doc-1',
                vector: Array(dimension).fill(0).map(() => Math.random()),
                content: 'React hooks allow you to use state and other React features without writing a class. The useState hook lets you add state to functional components.',
                relativePath: 'docs/react/hooks.md',
                startLine: 1,
                endLine: 3,
                fileExtension: 'md',
                metadata: {
                    category: 'frontend',
                    framework: 'react',
                    topic: 'hooks',
                    difficulty: 'intermediate'
                }
            },
            {
                id: 'doc-2',
                vector: Array(dimension).fill(0).map(() => Math.random()),
                content: 'TypeScript interfaces define the structure of an object. They provide type checking and IntelliSense support in your IDE.',
                relativePath: 'docs/typescript/interfaces.md',
                startLine: 1,
                endLine: 2,
                fileExtension: 'md',
                metadata: {
                    category: 'language',
                    framework: 'typescript',
                    topic: 'types',
                    difficulty: 'beginner'
                }
            },
            {
                id: 'doc-3',
                vector: Array(dimension).fill(0).map(() => Math.random()),
                content: 'Async/await syntax makes asynchronous code easier to read and write. It works with Promises and helps avoid callback hell.',
                relativePath: 'docs/javascript/async.md',
                startLine: 1,
                endLine: 2,
                fileExtension: 'md',
                metadata: {
                    category: 'language',
                    framework: 'javascript',
                    topic: 'async',
                    difficulty: 'intermediate'
                }
            }
        ];

        await vectorDb.insertHybrid(collectionName, documents);

        // Hybrid search: combining vector similarity with text search
        const searchRequests: HybridSearchRequest[] = [
            {
                data: Array(dimension).fill(0).map(() => Math.random()), // Vector query
                anns_field: 'vector',
                param: { metric_type: 'COSINE' },
                limit: 10
            },
            {
                data: 'async await promises', // Text query
                anns_field: 'sparse_vector',
                param: {},
                limit: 10
            }
        ];

        const results = await vectorDb.hybridSearch(collectionName, searchRequests, {
            limit: 3,
            filterExpr: "fileExtension eq 'md'",
            rerank: {
                strategy: 'weighted',
                params: { weights: [0.6, 0.4] }
            }
        });

        console.log(`\n📊 Hybrid Search Results (found ${results.length} matches):`);
        results.forEach((result, index) => {
            console.log(`\n  Result ${index + 1}:`);
            console.log(`    Combined Score: ${result.score.toFixed(4)}`);
            console.log(`    File: ${result.document.relativePath}`);
            console.log(`    Topic: ${result.document.metadata.topic}`);
            console.log(`    Difficulty: ${result.document.metadata.difficulty}`);
            console.log(`    Content: ${result.document.content}`);
        });

        await vectorDb.dropCollection(collectionName);
        console.log('\n✅ Example 2 completed successfully');
    } catch (error) {
        console.error('❌ Error in Example 2:', error);
    } finally {
        await vectorDb.close();
    }
}

// ============================================================================
// Example 3: Advanced Filtering and Querying
// ============================================================================

async function example3_AdvancedFiltering() {
    console.log('\n' + '='.repeat(80));
    console.log('Example 3: Advanced Filtering and Queries');
    console.log('='.repeat(80));

    const vectorDb = await initializeDatabase();

    try {
        const collectionName = 'codebase';
        const dimension = 512;

        await vectorDb.createCollection(collectionName, dimension);

        const documents: VectorDocument[] = [
            {
                id: 'file-1',
                vector: Array(dimension).fill(0).map(() => Math.random()),
                content: 'import React from "react"; export const Button = () => <button>Click me</button>;',
                relativePath: 'src/components/Button.tsx',
                startLine: 1,
                endLine: 1,
                fileExtension: 'tsx',
                metadata: { component: true, framework: 'react', exported: true }
            },
            {
                id: 'file-2',
                vector: Array(dimension).fill(0).map(() => Math.random()),
                content: 'export function calculateTax(amount, rate) { return amount * rate; }',
                relativePath: 'src/utils/tax.js',
                startLine: 5,
                endLine: 7,
                fileExtension: 'js',
                metadata: { utility: true, exported: true }
            },
            {
                id: 'file-3',
                vector: Array(dimension).fill(0).map(() => Math.random()),
                content: 'const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3000";',
                relativePath: 'src/config/env.ts',
                startLine: 1,
                endLine: 1,
                fileExtension: 'ts',
                metadata: { config: true, exported: false }
            },
            {
                id: 'file-4',
                vector: Array(dimension).fill(0).map(() => Math.random()),
                content: 'interface User { id: string; name: string; email: string; }',
                relativePath: 'src/types/user.ts',
                startLine: 1,
                endLine: 1,
                fileExtension: 'ts',
                metadata: { type: true, exported: true }
            }
        ];

        await vectorDb.insert(collectionName, documents);

        // Example 3a: Filter by file extension and line range
        console.log('\n🔍 Query 1: TypeScript files only');
        const tsFiles = await vectorDb.query(
            collectionName,
            "fileExtension eq 'ts' or fileExtension eq 'tsx'",
            ['id', 'relativePath', 'fileExtension'],
            10
        );
        console.log(`  Found ${tsFiles.length} TypeScript files:`);
        tsFiles.forEach(doc => console.log(`    - ${doc.relativePath}`));

        // Example 3b: Complex filter with multiple conditions
        console.log('\n🔍 Query 2: Exported utilities in JavaScript');
        const exportedUtils = await vectorDb.query(
            collectionName,
            "fileExtension eq 'js'",
            ['id', 'relativePath', 'content'],
            10
        );
        console.log(`  Found ${exportedUtils.length} JavaScript files:`);
        exportedUtils.forEach(doc => {
            console.log(`    - ${doc.relativePath}`);
            console.log(`      ${doc.content.substring(0, 60)}...`);
        });

        // Example 3c: Get collection statistics
        const stats = await vectorDb.getCollectionStats(collectionName);
        console.log(`\n📈 Collection Statistics:`);
        console.log(`  Total documents: ${stats.entityCount}`);

        // Example 3d: Delete specific documents
        console.log('\n🗑️  Deleting documents...');
        await vectorDb.delete(collectionName, ['file-2']);
        const updatedStats = await vectorDb.getCollectionStats(collectionName);
        console.log(`  Documents after deletion: ${updatedStats.entityCount}`);

        await vectorDb.dropCollection(collectionName);
        console.log('\n✅ Example 3 completed successfully');
    } catch (error) {
        console.error('❌ Error in Example 3:', error);
    } finally {
        await vectorDb.close();
    }
}

// ============================================================================
// Example 4: Collection Management
// ============================================================================

async function example4_CollectionManagement() {
    console.log('\n' + '='.repeat(80));
    console.log('Example 4: Collection Management and Limits');
    console.log('='.repeat(80));

    const vectorDb = await initializeDatabase();

    try {
        // Check collection limit
        const canCreate = await vectorDb.checkCollectionLimit();
        console.log(`\n📊 Can create new collections: ${canCreate ? 'Yes' : 'No'}`);

        // List existing collections
        const collections = await vectorDb.listCollections();
        console.log(`\n📋 Existing collections (${collections.length}):`);
        collections.forEach((name, index) => {
            console.log(`  ${index + 1}. ${name}`);
        });

        // Create test collection
        const testCollection = 'test-collection-' + Date.now();
        console.log(`\n📦 Creating test collection: ${testCollection}`);
        await vectorDb.createCollection(testCollection, 128);

        // Check if it exists
        const exists = await vectorDb.hasCollection(testCollection);
        console.log(`✅ Collection exists: ${exists}`);

        // List again to see the new collection
        const updatedCollections = await vectorDb.listCollections();
        console.log(`\n📋 Updated collections (${updatedCollections.length}):`);
        const newCollection = updatedCollections.find(c => c === testCollection);
        if (newCollection) {
            console.log(`  ✨ New: ${newCollection}`);
        }

        // Clean up
        console.log(`\n🗑️  Dropping test collection...`);
        await vectorDb.dropCollection(testCollection);

        const stillExists = await vectorDb.hasCollection(testCollection);
        console.log(`✅ Collection removed: ${!stillExists}`);

        console.log('\n✅ Example 4 completed successfully');
    } catch (error) {
        console.error('❌ Error in Example 4:', error);
    } finally {
        await vectorDb.close();
    }
}

// ============================================================================
// Main Execution
// ============================================================================

async function runAllExamples() {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 Azure AI Search Vector Database - Examples');
    console.log('='.repeat(80));

    try {
        await example1_BasicVectorSearch();
        await example2_HybridSearch();
        await example3_AdvancedFiltering();
        await example4_CollectionManagement();

        console.log('\n' + '='.repeat(80));
        console.log('✨ All examples completed successfully!');
        console.log('='.repeat(80) + '\n');
    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run examples if this file is executed directly
if (require.main === module) {
    runAllExamples().catch(console.error);
}

// Export for use in other files
export {
    example1_BasicVectorSearch,
    example2_HybridSearch,
    example3_AdvancedFiltering,
    example4_CollectionManagement,
    runAllExamples
};