import * as path from 'path';
import * as fs from 'fs';
import { 
    MilvusVectorDatabase, 
    OpenAIEmbedding, 
    VoyageAIEmbedding,
    GeminiEmbedding,
    OllamaEmbedding,
    AstCodeSplitter, 
    Context, 
    envManager 
} from '../../index';
import { VectorDocument, VectorSearchResult, HybridSearchRequest } from '../../vectordb/types';
import { Embedding } from '../../embedding/base-embedding';

// Test configuration using envManager with realistic defaults
const getMilvusConfig = () => {
    const address = envManager.get('MILVUS_ADDRESS') || 'localhost:19530';
    const token = envManager.get('MILVUS_TOKEN');
    const username = envManager.get('MILVUS_USERNAME') || 'root';
    const password = envManager.get('MILVUS_PASSWORD') || 'Milvus';
    
    return {
        address,
        ...(token && { token }),
        ...(username && !token && { username }),
        ...(password && !token && { password }),
        ssl: false
    };
};

// Create embedding instance based on configuration
const createEmbeddingProvider = (): Embedding => {
    const provider = envManager.get('EMBEDDING_PROVIDER') || 'OpenAI';
    
    switch (provider.toLowerCase()) {
        case 'openai':
            return new OpenAIEmbedding({
                apiKey: envManager.get('OPENAI_API_KEY') || 'test-key-placeholder',
                model: envManager.get('EMBEDDING_MODEL') || 'text-embedding-3-small',
                ...(envManager.get('OPENAI_BASE_URL') && { baseURL: envManager.get('OPENAI_BASE_URL') })
            });
            
        case 'voyageai':
            return new VoyageAIEmbedding({
                apiKey: envManager.get('VOYAGEAI_API_KEY') || 'test-key-placeholder',
                model: envManager.get('EMBEDDING_MODEL') || 'voyage-code-3'
            });
            
        case 'gemini':
            return new GeminiEmbedding({
                apiKey: envManager.get('GEMINI_API_KEY') || 'test-key-placeholder',
                model: envManager.get('EMBEDDING_MODEL') || 'gemini-embedding-001',
                ...(envManager.get('GEMINI_BASE_URL') && { baseURL: envManager.get('GEMINI_BASE_URL') })
            });
            
        case 'ollama':
            return new OllamaEmbedding({
                host: envManager.get('OLLAMA_HOST') || 'http://127.0.0.1:11434',
                model: envManager.get('OLLAMA_MODEL') || 'nomic-embed-text'
            });
            
        default:
            console.warn(`Unknown embedding provider: ${provider}, falling back to OpenAI`);
            return new OpenAIEmbedding({
                apiKey: envManager.get('OPENAI_API_KEY') || 'test-key-placeholder',
                model: 'text-embedding-3-small'
            });
    }
};

// Check if we have valid credentials for testing
const hasValidCredentials = (): boolean => {
    const provider = envManager.get('EMBEDDING_PROVIDER') || 'OpenAI';
    
    switch (provider.toLowerCase()) {
        case 'openai':
            const openaiKey = envManager.get('OPENAI_API_KEY');
            return !!(openaiKey && openaiKey !== 'test-key-placeholder');
            
        case 'voyageai':
            const voyageKey = envManager.get('VOYAGEAI_API_KEY');
            return !!(voyageKey && voyageKey !== 'test-key-placeholder');
            
        case 'gemini':
            const geminiKey = envManager.get('GEMINI_API_KEY');
            return !!(geminiKey && geminiKey !== 'test-key-placeholder');
            
        case 'ollama':
            // Ollama runs locally, so we just check if host is accessible
            // For tests, we'll assume it's available if configured
            return true;
            
        default:
            return false;
    }
};

// Test data - dimension will be determined dynamically
const TEST_COLLECTION_PREFIX = 'test_milvus_';

describe('MilvusVectorDatabase', () => {
    let database: MilvusVectorDatabase;
    let embedding: Embedding;
    let splitter: AstCodeSplitter;
    let context: Context;
    let testCollections: string[] = [];
    let testDimension: number;

    // Utility to create unique collection names
    const createTestCollection = (suffix: string): string => {
        const collectionName = `${TEST_COLLECTION_PREFIX}${suffix}_${Date.now()}`;
        testCollections.push(collectionName);
        return collectionName;
    };

    // Utility to read fixture files
    const readFixture = (filename: string): string => {
        const fixturePath = path.join(__dirname, '..', 'fixtures', filename);
        return fs.readFileSync(fixturePath, 'utf-8');
    };

    // Utility to create vector documents from fixtures
    const createFixtureDocuments = async (): Promise<VectorDocument[]> => {
        const fixtures = [
            { file: 'sample.php', lang: 'php' },
            { file: 'sample.js', lang: 'javascript' },
            { file: 'sample.ts', lang: 'typescript' },
            { file: 'sample.py', lang: 'python' }
        ];

        const documents: VectorDocument[] = [];
        
        for (const fixture of fixtures) {
            const code = readFixture(fixture.file);
            const chunks = await splitter.split(code, fixture.lang, fixture.file);
            
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const embedResult = await embedding.embed(chunk.content);
                const vector = embedResult.vector;
                
                documents.push({
                    id: database.generateId(`${fixture.file}_${i}`),
                    vector,
                    content: chunk.content,
                    relativePath: fixture.file,
                    startLine: chunk.metadata.startLine,
                    endLine: chunk.metadata.endLine,
                    fileExtension: path.extname(fixture.file),
                    metadata: {
                        language: fixture.lang,
                        filename: fixture.file,
                        chunkIndex: i
                    }
                });
            }
        }
        
        return documents;
    };

    beforeAll(async () => {
        // Check if we have valid credentials for testing
        if (!hasValidCredentials()) {
            const provider = envManager.get('EMBEDDING_PROVIDER') || 'OpenAI';
            console.log(`⚠️  Skipping Milvus tests - No valid credentials for ${provider} provider`);
            return;
        }

        // Initialize with realistic configuration
        const milvusConfig = getMilvusConfig();
        const provider = envManager.get('EMBEDDING_PROVIDER') || 'OpenAI';
        
        console.log('🔧 Milvus Test Configuration:', {
            address: milvusConfig.address,
            hasToken: !!milvusConfig.token,
            hasCredentials: !!(milvusConfig.username && milvusConfig.password),
            ssl: milvusConfig.ssl
        });
        
        console.log(`🤖 ${provider} Embedding Configuration:`, {
            provider,
            model: envManager.get('EMBEDDING_MODEL') || 'default',
            hasCustomSettings: !!(envManager.get('OPENAI_BASE_URL') || envManager.get('OLLAMA_HOST') || envManager.get('GEMINI_BASE_URL'))
        });

        database = new MilvusVectorDatabase(milvusConfig);
        embedding = createEmbeddingProvider();
        
        // Detect dimension dynamically
        testDimension = embedding.getDimension();
        console.log(`📐 Using dimension: ${testDimension} for ${provider}`);
        
        splitter = new AstCodeSplitter(
            parseInt(envManager.get('CHUNK_SIZE') || '2500'), 
            parseInt(envManager.get('CHUNK_OVERLAP') || '300')
        );
        
        context = new Context({
            embedding,
            vectorDatabase: database,
            codeSplitter: splitter,
            supportedExtensions: ['.ts', '.js', '.py', '.php', '.java', '.cpp', '.go', '.rs']
        });

        // Wait for database initialization
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    beforeEach(async () => {
        if (!hasValidCredentials()) return;
        
        // Clear any existing test collections before each test
        try {
            const collections = await database.listCollections();
            for (const collection of collections) {
                if (collection.startsWith(TEST_COLLECTION_PREFIX)) {
                    await database.dropCollection(collection);
                }
            }
        } catch (error) {
            console.warn('Error cleaning up collections:', error);
        }
        testCollections = [];
    });

    afterEach(async () => {
        if (!hasValidCredentials()) return;
        
        // Clean up test collections
        for (const collection of testCollections) {
            try {
                if (await database.hasCollection(collection)) {
                    await database.dropCollection(collection);
                }
            } catch (error) {
                console.warn(`Failed to drop collection ${collection}:`, error);
            }
        }
        testCollections = [];
    });

    describe('Collection Management', () => {
        test('should create a collection', async () => {
            if (!hasValidCredentials()) return;

            const collectionName = createTestCollection('basic');
            
            await database.createCollection(collectionName, testDimension, 'Test collection');
            
            const exists = await database.hasCollection(collectionName);
            expect(exists).toBe(true);
        });

        test('should create a hybrid collection', async () => {
            if (!hasValidCredentials()) return;

            const collectionName = createTestCollection('hybrid');
            
            await database.createHybridCollection(collectionName, testDimension, 'Test hybrid collection');
            
            const exists = await database.hasCollection(collectionName);
            expect(exists).toBe(true);
        });

        test('should drop a collection', async () => {
            if (!hasValidCredentials()) return;

            const collectionName = createTestCollection('drop_test');
            
            await database.createCollection(collectionName, testDimension);
            expect(await database.hasCollection(collectionName)).toBe(true);
            
            await database.dropCollection(collectionName);
            expect(await database.hasCollection(collectionName)).toBe(false);
            
            // Remove from cleanup list since it's already dropped
            testCollections = testCollections.filter(c => c !== collectionName);
        });

        test('should check collection existence', async () => {
            if (!hasValidCredentials()) return;

            const existingCollection = createTestCollection('exists');
            const nonExistentCollection = `${TEST_COLLECTION_PREFIX}nonexistent_${Date.now()}`;
            
            await database.createCollection(existingCollection, testDimension);
            
            expect(await database.hasCollection(existingCollection)).toBe(true);
            expect(await database.hasCollection(nonExistentCollection)).toBe(false);
        });

        test('should list collections', async () => {
            if (!hasValidCredentials()) return;

            const collection1 = createTestCollection('list1');
            const collection2 = createTestCollection('list2');
            
            await database.createCollection(collection1, testDimension);
            await database.createCollection(collection2, testDimension);
            
            const collections = await database.listCollections();
            
            expect(collections).toContain(collection1);
            expect(collections).toContain(collection2);
        });

        test('should check collection limit', async () => {
            if (!hasValidCredentials()) return;

            // This test doesn't need a collection - just checks the limit
            const canCreate = await database.checkCollectionLimit();
            expect(typeof canCreate).toBe('boolean');
        });
    });

    describe('Document Operations', () => {
        let testCollection: string;
        let sampleDocuments: VectorDocument[];

        beforeEach(async () => {
            if (!hasValidCredentials()) return;

            testCollection = createTestCollection('docs');
            await database.createCollection(testCollection, testDimension);
            
            // Create a smaller set of documents for testing
            sampleDocuments = await createFixtureDocuments();
            // Take only first 5 documents to speed up tests
            sampleDocuments = sampleDocuments.slice(0, 5);
        });

        test('should insert documents', async () => {
            if (!hasValidCredentials()) return;

            await expect(database.insert(testCollection, sampleDocuments)).resolves.not.toThrow();
        });

        test('should insert hybrid documents', async () => {
            if (!hasValidCredentials()) return;

            const hybridCollection = createTestCollection('hybrid_docs');
            await database.createHybridCollection(hybridCollection, testDimension);
            
            await expect(database.insertHybrid(hybridCollection, sampleDocuments)).resolves.not.toThrow();
        });

        test('should delete documents', async () => {
            if (!hasValidCredentials()) return;

            await database.insert(testCollection, sampleDocuments);
            
            const idsToDelete = sampleDocuments.slice(0, 2).map(doc => doc.id);
            
            await expect(database.delete(testCollection, idsToDelete)).resolves.not.toThrow();
        });

        test('should generate valid IDs', async () => {
            if (!hasValidCredentials()) return;

            // This test doesn't need a collection - just tests ID generation
            const id1 = database.generateId('test-file.php_1');
            const id2 = database.generateId('test-file.js_2');
            
            expect(typeof id1).toBe('string');
            expect(typeof id2).toBe('string');
            expect(id1).not.toBe(id2);
            expect(id1.length).toBeGreaterThan(0);
        });
    });

    describe('Search Operations', () => {
        let testCollection: string;
        let sampleDocuments: VectorDocument[];

        beforeEach(async () => {
            if (!hasValidCredentials()) return;

            testCollection = createTestCollection('search');
            await database.createCollection(testCollection, testDimension);
            
            sampleDocuments = await createFixtureDocuments();
            // Use subset for faster tests
            sampleDocuments = sampleDocuments.slice(0, 8);
            
            await database.insert(testCollection, sampleDocuments);
            
            // Wait for indexing
            await new Promise(resolve => setTimeout(resolve, 2000));
        });

        test('should perform basic search', async () => {
            if (!hasValidCredentials()) return;

            const query = 'database connection class';
            const queryResult = await embedding.embed(query);
            const queryVector = queryResult.vector;
            
            const results = await database.search(testCollection, queryVector, { topK: 3 });
            
            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeGreaterThan(0);
            expect(results.length).toBeLessThanOrEqual(3);
            
            results.forEach(result => {
                expect(result).toHaveProperty('document');
                expect(result).toHaveProperty('score');
                expect(typeof result.score).toBe('number');
                expect(result.document).toHaveProperty('content');
                expect(result.document).toHaveProperty('relativePath');
            });
        });

        test('should perform search with filter', async () => {
            if (!hasValidCredentials()) return;

            const query = 'function implementation';
            const queryResult = await embedding.embed(query);
            const queryVector = queryResult.vector;
            
            // Test extension filter
            const phpFilter = database.buildExtensionFilter(['.php']);
            const phpResults = await database.search(testCollection, queryVector, { 
                topK: 5,
                filterExpr: phpFilter
            });
            
            expect(Array.isArray(phpResults)).toBe(true);
            phpResults.forEach(result => {
                expect(result.document.fileExtension).toBe('.php');
            });

            // Test path filter  
            const pathFilter = database.buildPathFilter('sample.js');
            const jsResults = await database.search(testCollection, queryVector, {
                topK: 5,
                filterExpr: pathFilter
            });
            
            expect(Array.isArray(jsResults)).toBe(true);
            jsResults.forEach(result => {
                expect(result.document.relativePath).toBe('sample.js');
            });
        });

        test('should perform hybrid search', async () => {
            if (!hasValidCredentials()) return;

            const hybridCollection = createTestCollection('hybrid_search');
            await database.createHybridCollection(hybridCollection, testDimension);
            await database.insertHybrid(hybridCollection, sampleDocuments);
            
            // Wait for indexing
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const query = 'class method definition';
            const queryResult = await embedding.embed(query);
            const queryVector = queryResult.vector;
            
            const searchRequests: HybridSearchRequest[] = [
                {
                    data: queryVector,
                    anns_field: 'vector',
                    param: { metric_type: 'COSINE' },
                    limit: 5
                },
                {
                    data: 'class method definition',  // Sparse vector as text query
                    anns_field: 'sparse_vector',
                    param: { drop_ratio_search: 0.2 },
                    limit: 5
                }
            ];
            
            const results = await database.hybridSearch(hybridCollection, searchRequests, {
                limit: 3,
                rerank: { strategy: 'rrf' as const }
            });
            
            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeGreaterThan(0);
            expect(results.length).toBeLessThanOrEqual(3);
        });

        test('should query documents with filters', async () => {
            if (!hasValidCredentials()) return;

            // Query all PHP documents
            const phpFilter = database.buildExtensionFilter(['.php']);
            const phpResults = await database.query(
                testCollection,
                phpFilter,
                ['id', 'relativePath', 'fileExtension'],
                10
            );
            
            expect(Array.isArray(phpResults)).toBe(true);
            phpResults.forEach(result => {
                expect(result).toHaveProperty('relativePath');
                expect(result).toHaveProperty('fileExtension');
            });
        });
    });

    describe('Filter Building', () => {
        // These tests don't need collections - just test filter building methods
        test('should build extension filter for single extension', async () => {
            if (!hasValidCredentials()) return;

            const filter = database.buildExtensionFilter(['.ts']);
            
            expect(typeof filter).toBe('string');
            expect(filter).toContain('fileExtension');
            expect(filter).toContain('.ts');
        });

        test('should build extension filter for multiple extensions', async () => {
            if (!hasValidCredentials()) return;

            const filter = database.buildExtensionFilter(['.php', '.js', '.py']);
            
            expect(typeof filter).toBe('string');
            expect(filter).toContain('fileExtension');
            expect(filter).toContain('.php');
            expect(filter).toContain('.js');
            expect(filter).toContain('.py');
        });

        test('should build path filter', async () => {
            if (!hasValidCredentials()) return;

            const filter = database.buildPathFilter('src/utils/helper.ts');
            
            expect(typeof filter).toBe('string');
            expect(filter).toContain('relativePath');
            expect(filter).toContain('src/utils/helper.ts');
        });

        test('should handle path filter with special characters', async () => {
            if (!hasValidCredentials()) return;

            const pathWithBackslashes = 'src\\components\\UserForm.tsx';
            const filter = database.buildPathFilter(pathWithBackslashes);
            
            expect(typeof filter).toBe('string');
            expect(filter).toContain('relativePath');
            // Should properly escape backslashes
            expect(filter).toContain('\\\\');
        });
    });


    describe('Integration with Context and AST Splitter', () => {
        test('should index and search fixture files using Context', async () => {
            if (!hasValidCredentials()) return;

            const tempDir = path.join(__dirname, '..', 'fixtures');
            
            // Get the Context collection name that will be created
            const contextCollectionName = context.getCollectionName(tempDir);
            
            try {
                // Index the fixtures directory
                const stats = await context.indexCodebase(tempDir);
                
                expect(stats.indexedFiles).toBeGreaterThan(0);
                expect(stats.totalChunks).toBeGreaterThan(0);
                
                // Search for specific patterns
                const queries = [
                    'class definition',
                    'function implementation', 
                    'interface declaration',
                    'database connection'
                ];
                
                for (const query of queries) {
                    const results = await context.semanticSearch(tempDir, query, 3);
                    expect(Array.isArray(results)).toBe(true);
                    
                    results.forEach(result => {
                        expect(result).toHaveProperty('content');
                        expect(result).toHaveProperty('relativePath');
                        expect(result).toHaveProperty('score');
                        expect(result).toHaveProperty('language');
                    });
                }
            } finally {
                // Clean up Context-generated collection
                try {
                    if (await database.hasCollection(contextCollectionName)) {
                        await database.dropCollection(contextCollectionName);
                    }
                } catch (error) {
                    console.warn(`Failed to clean up Context collection ${contextCollectionName}:`, error);
                }
            }
        }, 60000); // 60 second timeout for indexing

        test('should respect file extension filters in search', async () => {
            if (!hasValidCredentials()) return;

            const tempDir = path.join(__dirname, '..', 'fixtures');
            
            // Get the Context collection name that will be created
            const contextCollectionName = context.getCollectionName(tempDir);
            
            try {
                // Index all fixtures
                await context.indexCodebase(tempDir);
                
                // Search with PHP extension filter
                const phpFilter = database.buildExtensionFilter(['.php']);
                const phpResults = await context.semanticSearch(
                    tempDir, 
                    'class method', 
                    5,
                    0.0,
                    phpFilter
                );
                
                expect(Array.isArray(phpResults)).toBe(true);
                phpResults.forEach(result => {
                    expect(result.relativePath).toMatch(/\.php$/);
                });
                
                // Search with TypeScript extension filter
                const tsFilter = database.buildExtensionFilter(['.ts']);
                const tsResults = await context.semanticSearch(
                    tempDir,
                    'interface definition',
                    5, 
                    0.0,
                    tsFilter
                );
                
                expect(Array.isArray(tsResults)).toBe(true);
                tsResults.forEach(result => {
                    expect(result.relativePath).toMatch(/\.ts$/);
                });
            } finally {
                // Clean up Context-generated collection
                try {
                    if (await database.hasCollection(contextCollectionName)) {
                        await database.dropCollection(contextCollectionName);
                    }
                } catch (error) {
                    console.warn(`Failed to clean up Context collection ${contextCollectionName}:`, error);
                }
            }
        }, 60000);
    });

    describe('Error Handling', () => {
        test('should handle non-existent collection gracefully', async () => {
            if (!hasValidCredentials()) return;

            const nonExistentCollection = 'non_existent_collection';
            
            await expect(database.hasCollection(nonExistentCollection)).resolves.toBe(false);
            
            // Query on non-existent collection should throw
            await expect(
                database.query(nonExistentCollection, '', ['id'])
            ).rejects.toThrow();
        });

        test('should handle empty search results', async () => {
            if (!hasValidCredentials()) return;

            const emptyCollection = createTestCollection('empty');
            await database.createCollection(emptyCollection, testDimension);
            
            const queryResult = await embedding.embed('test query');
            const queryVector = queryResult.vector;
            const results = await database.search(emptyCollection, queryVector);
            
            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBe(0);
        });

        test('should handle invalid filter expressions gracefully', async () => {
            if (!hasValidCredentials()) return;

            const testCollection = createTestCollection('filter_error');
            await database.createCollection(testCollection, testDimension);
            
            // Insert some documents
            const docs = await createFixtureDocuments();
            await database.insert(testCollection, docs.slice(0, 2));
            
            const queryResult = await embedding.embed('test');
            const queryVector = queryResult.vector;
            
            // Test with malformed filter - Milvus may return empty results or throw error
            try {
                const results = await database.search(testCollection, queryVector, {
                    topK: 1,
                    filterExpr: 'invalid filter syntax [malformed'
                });
                // If it doesn't throw, it should return an array (possibly empty)
                expect(Array.isArray(results)).toBe(true);
            } catch (error) {
                // If it does throw, that's also acceptable error handling
                expect(error).toBeDefined();
            }
        });
    });

    describe('Performance', () => {
        test('should complete search operations within reasonable time', async () => {
            if (!hasValidCredentials()) return;

            const perfCollection = createTestCollection('performance');
            await database.createCollection(perfCollection, testDimension);
            
            const docs = await createFixtureDocuments();
            await database.insert(perfCollection, docs.slice(0, 10));
            
            // Wait for indexing
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const queryResult = await embedding.embed('performance test query');
            const queryVector = queryResult.vector;
            
            const startTime = Date.now();
            const results = await database.search(perfCollection, queryVector, { topK: 5 });
            const duration = Date.now() - startTime;
            
            expect(results.length).toBeGreaterThan(0);
            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
            
            console.log(`Milvus search completed in ${duration}ms`);
        });
    });
});