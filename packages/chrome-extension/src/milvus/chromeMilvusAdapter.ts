// Import core types and implementation
import { MilvusConfig, MilvusConfigManager } from '../config/milvusConfig';

// We'll create a simplified version that works in Chrome extension environment
// Import types from a stub file instead of the core package
import { VectorDocument, VectorSearchResult, SearchOptions } from '../stubs/milvus-vectordb-stub';
import { MilvusRestfulVectorDatabase } from '../stubs/milvus-vectordb-stub';

export interface CodeChunk {
    id: string;
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    fileExtension: string;
    metadata: string;
    vector?: number[];
}

export interface SearchResult {
    id: string;
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    fileExtension: string;
    metadata: string;
    score: number;
}

/**
 * Chrome Extension adapter for Milvus RESTful Vector Database
 * This class wraps the core MilvusRestfulVectorDatabase to provide
 * Chrome extension specific functionality
 */
export class ChromeMilvusAdapter {
    private milvusDb: MilvusRestfulVectorDatabase | null = null;
    private collectionName: string;

    constructor(collectionName: string = 'chrome_code_chunks') {
        this.collectionName = collectionName;
    }

    /**
     * Initialize connection to Milvus
     */
    async initialize(): Promise<void> {
        const config = await MilvusConfigManager.getMilvusConfig();
        if (!config || !MilvusConfigManager.validateMilvusConfig(config)) {
            throw new Error('Invalid or missing Milvus configuration');
        }

        // Convert our config to core format
        const coreConfig = {
            address: config.address,
            token: config.token,
            username: config.username,
            password: config.password,
            database: config.database
        };

        this.milvusDb = new MilvusRestfulVectorDatabase(coreConfig);
        console.log('🔌 Chrome Milvus adapter initialized');
    }

    /**
     * Create collection for the repository
     */
    async createCollection(dimension: number = 1536): Promise<void> {
        if (!this.milvusDb) {
            throw new Error('Milvus not initialized');
        }

        try {
            await this.milvusDb.createCollection(this.collectionName, dimension, 'Chrome extension code chunks');
            console.log(`✅ Collection '${this.collectionName}' created successfully`);
        } catch (error) {
            console.error('❌ Failed to create collection:', error);
            throw error;
        }
    }

    /**
     * Check if collection exists
     */
    async collectionExists(): Promise<boolean> {
        if (!this.milvusDb) {
            return false;
        }

        try {
            return await this.milvusDb.hasCollection(this.collectionName);
        } catch (error) {
            console.error('Error checking collection existence:', error);
            return false;
        }
    }

    /**
     * Insert code chunks into Milvus
     */
    async insertChunks(chunks: CodeChunk[]): Promise<void> {
        if (!this.milvusDb) {
            throw new Error('Milvus not initialized');
        }

        if (chunks.length === 0) {
            return;
        }

        // Convert to vector documents format
        const documents = chunks.map(chunk => ({
            id: chunk.id,
            vector: chunk.vector || [],
            content: chunk.content,
            relativePath: chunk.relativePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            fileExtension: chunk.fileExtension,
            metadata: JSON.parse(chunk.metadata || '{}') // Parse metadata string to object
        }));

        try {
            await this.milvusDb.insert(this.collectionName, documents);
            console.log(`✅ Inserted ${documents.length} chunks into Milvus`);
        } catch (error) {
            console.error('❌ Failed to insert chunks:', error);
            throw error;
        }
    }

    /**
     * Search for similar code chunks
     */
    async searchSimilar(queryVector: number[], limit: number = 10, threshold: number = 0.3): Promise<SearchResult[]> {
        if (!this.milvusDb) {
            throw new Error('Milvus not initialized');
        }

        try {
            const searchOptions: SearchOptions = {
                topK: limit,
                threshold
            };

            const results = await this.milvusDb.search(this.collectionName, queryVector, searchOptions);

            // Convert results to our format and ensure they're sorted by score (descending)
            const searchResults = results.map(result => ({
                id: result.document.id,
                content: result.document.content,
                relativePath: result.document.relativePath,
                startLine: result.document.startLine,
                endLine: result.document.endLine,
                fileExtension: result.document.fileExtension,
                metadata: JSON.stringify(result.document.metadata), // Convert back to string
                score: result.score
            }));

            // Additional sorting to ensure results are in descending order by score
            searchResults.sort((a, b) => b.score - a.score);

            console.log(`🔍 Found ${searchResults.length} results with cosine similarity scores:`, 
                searchResults.slice(0, 5).map(r => ({ 
                    path: r.relativePath.split('/').pop(), 
                    score: r.score.toFixed(4),
                    lines: `${r.startLine}-${r.endLine}`
                })));

            return searchResults;
        } catch (error) {
            console.error('❌ Search failed:', error);
            throw error;
        }
    }

    /**
     * Clear all data in the collection
     */
    async clearCollection(): Promise<void> {
        if (!this.milvusDb) {
            throw new Error('Milvus not initialized');
        }

        try {
            await this.milvusDb.dropCollection(this.collectionName);
            console.log(`✅ Collection '${this.collectionName}' cleared successfully`);
        } catch (error) {
            console.error('❌ Failed to clear collection:', error);
            throw error;
        }
    }

    /**
     * Get collection statistics
     */
    async getCollectionStats(): Promise<{ totalEntities: number } | null> {
        if (!this.milvusDb) {
            return null;
        }

        try {
            const stats = await this.milvusDb.getCollectionStats(this.collectionName);
            return {
                totalEntities: stats.entityCount || 0
            };
        } catch (error) {
            console.error('❌ Failed to get collection stats:', error);
            return null;
        }
    }

    /**
     * Test connection to Milvus
     */
    async testConnection(): Promise<boolean> {
        try {
            // Get configuration
            const config = await MilvusConfigManager.getMilvusConfig();
            if (!config) {
                console.error('No Milvus configuration found');
                throw new Error('No Milvus configuration found');
            }

            if (!MilvusConfigManager.validateMilvusConfig(config)) {
                console.error('Invalid Milvus configuration');
                throw new Error('Invalid Milvus configuration');
            }

            console.log('Testing connection with config:', { 
                address: config.address, 
                database: config.database,
                hasToken: !!config.token,
                hasUsername: !!config.username
            });

            // Try to create a temporary MilvusRestfulVectorDatabase instance
            const coreConfig = {
                address: config.address,
                token: config.token,
                username: config.username,
                password: config.password,
                database: config.database
            };

            const testDb = new MilvusRestfulVectorDatabase(coreConfig);
            
            // Try to make a simple request to test connectivity
            // We'll try to check if a collection exists as a basic connectivity test
            try {
                await testDb.hasCollection('_test_connection_');
                console.log('Milvus connection test successful');
                return true;
            } catch (error) {
                console.error('Milvus connection test failed:', error);
                throw error;
            }

        } catch (error) {
            console.error('Connection test failed:', error);
            throw error;
        }
    }
}
