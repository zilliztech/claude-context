// Global test setup for vector database tests
// This file is run before each test file

import { envManager } from '../index';

// Set test environment variables
process.env.NODE_ENV = 'test';

// Increase timeout for database operations
jest.setTimeout(60000);

// Display configuration information before tests start
console.log('🧪 Test Environment Configuration:');
console.log('================================');

// Check embedding configuration
const embeddingProvider = envManager.get('EMBEDDING_PROVIDER') || 'OpenAI';
const embeddingModel = envManager.get('EMBEDDING_MODEL') || 'text-embedding-3-small';
const hasOpenAIKey = !!(envManager.get('OPENAI_API_KEY') && envManager.get('OPENAI_API_KEY') !== 'test-key-placeholder');

console.log('🤖 Embedding Configuration:');
console.log(`   Provider: ${embeddingProvider}`);
console.log(`   Model: ${embeddingModel}`);
console.log(`   OpenAI API Key: ${hasOpenAIKey ? '✅ Available' : '❌ Not provided or placeholder'}`);

// Check vector database configurations
const milvusAddress = envManager.get('MILVUS_ADDRESS') || 'localhost:19530';
const hasMilvusToken = !!envManager.get('MILVUS_TOKEN');

const qdrantUrl = envManager.get('QDRANT_URL') || 'http://localhost:6333';
const hasQdrantKey = !!envManager.get('QDRANT_API_KEY');

console.log('💾 Vector Database Configuration:');
console.log(`   Milvus Address: ${milvusAddress}`);
console.log(`   Milvus Token: ${hasMilvusToken ? '✅ Available' : '❌ Not provided (using username/password)'}`);
console.log(`   Qdrant URL: ${qdrantUrl}`);
console.log(`   Qdrant API Key: ${hasQdrantKey ? '✅ Available' : '❌ Not provided'}`);

// Check test-specific configuration  
const chunkSize = envManager.get('CHUNK_SIZE') || '2500';
const chunkOverlap = envManager.get('CHUNK_OVERLAP') || '300';

console.log('⚙️  Test Configuration:');
console.log(`   Chunk Size: ${chunkSize}`);
console.log(`   Chunk Overlap: ${chunkOverlap}`);

if (!hasOpenAIKey) {
    console.log('');
    console.log('ℹ️  Tests will be skipped without valid API keys. To run full tests, provide:');
    console.log('   - OPENAI_API_KEY: Your OpenAI API key');
    console.log('   - MILVUS_TOKEN: Your Zilliz Cloud token (optional)');
    console.log('   - QDRANT_API_KEY: Your Qdrant Cloud API key (optional)');
    console.log('');
}

console.log('================================');

// Suppress console logs during tests if needed (uncomment to enable)
// console.log = jest.fn();
// console.warn = jest.fn();
// console.error = jest.fn();