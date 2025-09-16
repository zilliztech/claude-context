import { Pool, PoolConfig } from 'pg';
import {
    VectorDocument,
    SearchOptions,
    VectorSearchResult,
    VectorDatabase,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult,
} from './types';

export interface PostgresConfig {
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    ssl?: boolean;
    maxConnections?: number;
    batchSize?: number; // Number of documents to insert in each batch (default: 100)
}

/**
 * PostgreSQL Vector Database implementation using pgvector extension
 * This implementation provides vector storage and similarity search using PostgreSQL with pgvector
 * Uses separate tables for each collection (codebase) for better data isolation and performance
 */
export class PostgresVectorDatabase implements VectorDatabase {
    protected config: PostgresConfig;
    private pool: Pool | null = null;
    protected initializationPromise: Promise<void>;

    constructor(config: PostgresConfig) {
        this.config = config;
        this.initializationPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        await this.initializeClient();
    }

    private async initializeClient(): Promise<void> {
        let poolConfig: PoolConfig;

        if (this.config.connectionString) {
            poolConfig = {
                connectionString: this.config.connectionString,
                max: this.config.maxConnections || 10,
            };
        } else {
            poolConfig = {
                host: this.config.host || 'localhost',
                port: this.config.port || 5432,
                database: this.config.database || 'postgres',
                user: this.config.username || 'postgres',
                password: this.config.password,
                ssl: this.config.ssl || false,
                max: this.config.maxConnections || 10,
            };
        }

        console.log('🔌 Connecting to PostgreSQL vector database...');
        this.pool = new Pool(poolConfig);

        // Test connection and ensure pgvector extension is available
        await this.ensurePgvectorExtension();
    }

    private async ensurePgvectorExtension(): Promise<void> {
        if (!this.pool) {
            throw new Error('PostgreSQL pool not initialized');
        }

        try {
            // Check if vectors extension exists (pgvector 0.6.0+ with optimized indexing)
            let result = await this.pool.query(
                "SELECT 1 FROM pg_extension WHERE extname = 'vectors'"
            );

            if (result.rows.length === 0) {
                // Fallback to check for 'vector' extension (older pgvector versions)
                result = await this.pool.query(
                    "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
                );

                if (result.rows.length === 0) {
                    console.error('❌ pgvector extension is not installed in this PostgreSQL database');
                    throw new Error(`pgvector extension is required but not installed. Please install it first`);
                } else {
                    console.log('✅ pgvector extension (vector) is available');
                }
            } else {
                console.log('✅ pgvector extension (vectors) is available');
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('pgvector extension is required')) {
                throw error; // Re-throw our custom error with installation instructions
            }
            console.error('❌ Failed to check pgvector extension:', error);
            throw new Error(`Failed to verify pgvector extension. Please ensure:
1. PostgreSQL is accessible
2. You have proper permissions
3. pgvector extension is installed and enabled`);
        }
    }

    protected async ensureInitialized(): Promise<void> {
        await this.initializationPromise;
        if (!this.pool) {
            throw new Error('PostgreSQL pool not initialized');
        }
    }



    private getTableName(collectionName: string): string {
        return collectionName.toLowerCase();
    }

    private async tableExists(tableName: string): Promise<boolean> {
        try {
            const result = await this.pool!.query(
                'SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = $2',
                [tableName, 'public']
            );
            return result.rows.length > 0;
        } catch (error) {
            console.error('❌ Failed to check table existence:', error);
            return false;
        }
    }

    async createCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();
        const tableName = this.getTableName(collectionName);

        try {
            // Create collection-specific table
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS ${tableName} (
                    id TEXT PRIMARY KEY,
                    vector vector(${dimension}),
                    content TEXT NOT NULL,
                    relative_path TEXT NOT NULL,
                    start_line INTEGER NOT NULL,
                    end_line INTEGER NOT NULL,
                    file_extension TEXT NOT NULL,
                    metadata text DEFAULT '{}'::text,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `;

            await this.pool!.query(createTableQuery);

            // Create vector similarity index using vectors extension with HNSW (with fallback to older syntax)
            const vectorIndexName = `${tableName}_vector_idx`;

            try {
                // Try newer vectors extension syntax first
                const createIndexQuery = `
                    CREATE INDEX IF NOT EXISTS ${vectorIndexName} 
                    ON ${tableName} 
                    USING vectors (vector vector_cos_ops) 
                    WITH (options = $$
[indexing.hnsw]
m = 30
ef_construction = 500
$$)
                `;
                await this.pool!.query(createIndexQuery);
                console.log(`✅ Created HNSW index using 'vectors' extension for ${tableName}`);
            } catch (error) {
                console.log(`⚠️  Failed to create index with 'vectors' extension, falling back to 'vector' extension...`);
                // Fallback to older vector extension syntax
                const fallbackIndexQuery = `
                    CREATE INDEX IF NOT EXISTS ${vectorIndexName} 
                    ON ${tableName} 
                    USING hnsw (vector vector_cosine_ops)
                    WITH (m = 30, ef_construction = 500)
                `;
                await this.pool!.query(fallbackIndexQuery);
                console.log(`✅ Created HNSW index using 'vector' extension for ${tableName}`);
            }

            // Create additional indexes for common query patterns
            await this.pool!.query(`CREATE INDEX IF NOT EXISTS ${tableName}_path_idx ON ${tableName} (relative_path)`);
            await this.pool!.query(`CREATE INDEX IF NOT EXISTS ${tableName}_ext_idx ON ${tableName} (file_extension)`);

            console.log(`✅ PostgreSQL collection '${collectionName}' created successfully with vector dimension ${dimension}`);
        } catch (error) {
            console.error(`❌ Failed to create collection '${collectionName}':`, error);
            throw error;
        }
    }

    async createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();
        const tableName = this.getTableName(collectionName);

        console.log(`[PostgresDB] 📝 Creating hybrid collection '${collectionName}' with full-text search support`);

        try {
            // Create collection-specific table with full-text search support
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS ${tableName} (
                    id TEXT PRIMARY KEY,
                    vector vector(${dimension}),
                    content TEXT NOT NULL,
                    relative_path TEXT NOT NULL,
                    start_line INTEGER NOT NULL,
                    end_line INTEGER NOT NULL,
                    file_extension TEXT NOT NULL,
                    metadata text DEFAULT '{}'::text,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    -- Add full-text search vector column
                    content_tsvector tsvector
                )
            `;

            await this.pool!.query(createTableQuery);

            // Create vector similarity index using vectors extension with HNSW (with fallback to older syntax)
            const vectorIndexName = `${tableName}_vector_idx`;

            try {
                // Try newer vectors extension syntax first
                const createIndexQuery = `
                    CREATE INDEX IF NOT EXISTS ${vectorIndexName} 
                    ON ${tableName} 
                    USING vectors (vector vector_cos_ops) 
                    WITH (options = $$
[indexing.hnsw]
m = 30
ef_construction = 500
$$)
                `;
                await this.pool!.query(createIndexQuery);
                console.log(`✅ Created HNSW index using 'vectors' extension for ${tableName}`);
            } catch (error) {
                console.log(`⚠️  Failed to create index with 'vectors' extension, falling back to 'vector' extension...`);
                // Fallback to older vector extension syntax
                const fallbackIndexQuery = `
                    CREATE INDEX IF NOT EXISTS ${vectorIndexName} 
                    ON ${tableName} 
                    USING hnsw (vector vector_cosine_ops)
                    WITH (m = 30, ef_construction = 500)
                `;
                await this.pool!.query(fallbackIndexQuery);
                console.log(`✅ Created HNSW index using 'vector' extension for ${tableName}`);
            }

            // Create full-text search index using GIN
            const fulltextIndexName = `${tableName}_fulltext_idx`;
            await this.pool!.query(`
                CREATE INDEX IF NOT EXISTS ${fulltextIndexName} 
                ON ${tableName} 
                USING gin(content_tsvector)
            `);

            // Note: No trigger needed - tsvector is populated directly during insert/update operations

            // Create additional indexes for common query patterns
            await this.pool!.query(`CREATE INDEX IF NOT EXISTS ${tableName}_path_idx ON ${tableName} (relative_path)`);
            await this.pool!.query(`CREATE INDEX IF NOT EXISTS ${tableName}_ext_idx ON ${tableName} (file_extension)`);

            // Update existing records to populate tsvector column if any exist
            await this.pool!.query(`
                UPDATE ${tableName} 
                SET content_tsvector = to_tsvector('english', content)
                WHERE content_tsvector IS NULL
            `);

            console.log(`✅ PostgreSQL hybrid collection '${collectionName}' created successfully with vector dimension ${dimension} and full-text search support`);
        } catch (error) {
            console.error(`❌ Failed to create hybrid collection '${collectionName}':`, error);
            throw error;
        }
    }

    async dropCollection(collectionName: string): Promise<void> {
        await this.ensureInitialized();
        const tableName = this.getTableName(collectionName);

        try {
            // Drop the entire collection table
            const dropQuery = `DROP TABLE IF EXISTS ${tableName}`;
            await this.pool!.query(dropQuery);
            console.log(`✅ PostgreSQL collection '${collectionName}' dropped successfully (table ${tableName} removed)`);
        } catch (error) {
            console.error(`❌ Failed to drop collection '${collectionName}':`, error);
            throw error;
        }
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        await this.ensureInitialized();
        const tableName = this.getTableName(collectionName);

        try {
            // Check if the collection table exists
            return await this.tableExists(tableName);
        } catch (error) {
            console.error(`❌ Failed to check collection existence '${collectionName}':`, error);
            return false;
        }
    }

    async listCollections(): Promise<string[]> {
        await this.ensureInitialized();

        try {
            // Get all tables that have vector columns (our vector database tables)
            const result = await this.pool!.query(`
                SELECT t.table_name 
                FROM information_schema.tables t
                JOIN information_schema.columns c ON t.table_name = c.table_name
                WHERE t.table_schema = 'public' 
                  AND c.table_schema = 'public'
                  AND c.data_type = 'USER-DEFINED'
                  AND c.udt_name = 'vector'
                ORDER BY t.table_name
            `);

            return result.rows.map(row => row.table_name);
        } catch (error) {
            console.error('❌ Failed to list collections:', error);
            throw error;
        }
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.ensureInitialized();
        const tableName = this.getTableName(collectionName);

        if (documents.length === 0) {
            return;
        }

        // Deduplicate documents by id (keep the last occurrence)
        // This is necessary as we batch insert the documents using on conflict do update, which means we need to ensure the id is unique in the batch.
        const deduplicatedDocs = Array.from(
            new Map(documents.map(doc => [doc.id, doc])).values()
        );

        const originalCount = documents.length;
        const deduplicatedCount = deduplicatedDocs.length;

        if (originalCount !== deduplicatedCount) {
            console.log(`[PostgresDB] 🔄 Deduplicated ${originalCount - deduplicatedCount} duplicate documents (${originalCount} → ${deduplicatedCount})`);
        }

        const startTime = Date.now();
        console.log(`[PostgresDB] 📝 Starting to insert ${deduplicatedCount} documents into collection '${collectionName}'...`);

        try {
            const client = await this.pool!.connect();
            try {
                await client.query('BEGIN');

                // Batch insert using VALUES with multiple rows
                // PostgreSQL parameter limit is ~65535, with 8 params per doc, max ~8000 docs per batch
                const batchSize = Math.min(this.config.batchSize || 100, 1000); // Cap at 1000 for safety
                for (let i = 0; i < deduplicatedDocs.length; i += batchSize) {
                    const batchStartTime = Date.now();
                    const batch = deduplicatedDocs.slice(i, i + batchSize);

                    // Build VALUES clause with placeholders and explicit type casting
                    const valuesClauses: string[] = [];
                    const allParams: any[] = []; // No collection name param needed

                    batch.forEach((doc, index) => {
                        const baseIndex = index * 8 + 1; // Each doc uses 8 params, starting from $1
                        valuesClauses.push(`($${baseIndex}::text, $${baseIndex + 1}::vector, $${baseIndex + 2}::text, $${baseIndex + 3}::text, $${baseIndex + 4}::integer, $${baseIndex + 5}::integer, $${baseIndex + 6}::text, $${baseIndex + 7}::text)`);

                        allParams.push(
                            doc.id,                                    // $baseIndex
                            `[${doc.vector.join(',')}]`,             // $baseIndex + 1
                            doc.content,                              // $baseIndex + 2
                            doc.relativePath,                         // $baseIndex + 3
                            doc.startLine,                           // $baseIndex + 4
                            doc.endLine,                             // $baseIndex + 5
                            doc.fileExtension,                       // $baseIndex + 6
                            JSON.stringify(doc.metadata)            // $baseIndex + 7
                        );
                    });

                    const batchInsertQuery = `
                        INSERT INTO ${tableName} 
                        (id, vector, content, relative_path, start_line, end_line, file_extension, metadata)
                        VALUES ${valuesClauses.join(', ')}
                        ON CONFLICT (id) DO UPDATE SET
                            vector = EXCLUDED.vector,
                            content = EXCLUDED.content,
                            relative_path = EXCLUDED.relative_path,
                            start_line = EXCLUDED.start_line,
                            end_line = EXCLUDED.end_line,
                            file_extension = EXCLUDED.file_extension,
                            metadata = EXCLUDED.metadata
                    `;

                    await client.query(batchInsertQuery, allParams);
                    const batchDuration = Date.now() - batchStartTime;
                    console.log(`✅ Batch inserted ${batch.length} documents (${i + 1}-${Math.min(i + batchSize, deduplicatedDocs.length)} of ${deduplicatedDocs.length}) in ${batchDuration}ms`);
                }

                await client.query('COMMIT');
                const totalDuration = Date.now() - startTime;
                const docsPerSecond = Math.round((deduplicatedDocs.length / totalDuration) * 1000);
                console.log(`✅ Successfully inserted ${deduplicatedDocs.length} documents into PostgreSQL collection '${collectionName}' in ${totalDuration}ms (${docsPerSecond} docs/sec)`);
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error(`❌ Failed to insert documents into collection '${collectionName}':`, error);
            throw error;
        }
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.ensureInitialized();
        const tableName = this.getTableName(collectionName);

        if (documents.length === 0) {
            return;
        }

        // Deduplicate documents by id (keep the last occurrence)
        const deduplicatedDocs = Array.from(
            new Map(documents.map(doc => [doc.id, doc])).values()
        );

        const originalCount = documents.length;
        const deduplicatedCount = deduplicatedDocs.length;

        if (originalCount !== deduplicatedCount) {
            console.log(`[PostgresDB] 🔄 Deduplicated ${originalCount - deduplicatedCount} duplicate documents (${originalCount} → ${deduplicatedCount})`);
        }

        const startTime = Date.now();
        console.log(`[PostgresDB] 📝 Starting to insert ${deduplicatedCount} documents for hybrid collection '${collectionName}' with full-text indexing...`);

        try {
            const client = await this.pool!.connect();
            try {
                await client.query('BEGIN');

                // Batch insert using VALUES with multiple rows
                // PostgreSQL parameter limit is ~65535, with 9 params per doc, max ~7000 docs per batch
                const batchSize = Math.min(this.config.batchSize || 100, 1000); // Cap at 1000 for safety
                for (let i = 0; i < deduplicatedDocs.length; i += batchSize) {
                    const batchStartTime = Date.now();
                    const batch = deduplicatedDocs.slice(i, i + batchSize);

                    // Build VALUES clause with placeholders and explicit type casting
                    const valuesClauses: string[] = [];
                    const allParams: any[] = []; // No collection name param needed

                    batch.forEach((doc, index) => {
                        const baseIndex = index * 9 + 1; // Each doc uses 9 params, starting from $1
                        valuesClauses.push(`($${baseIndex}::text, $${baseIndex + 1}::vector, $${baseIndex + 2}::text, $${baseIndex + 3}::text, $${baseIndex + 4}::integer, $${baseIndex + 5}::integer, $${baseIndex + 6}::text, $${baseIndex + 7}::text, to_tsvector('english', $${baseIndex + 2}))`);
                        allParams.push(
                            doc.id,                                    // $baseIndex
                            `[${doc.vector.join(',')}]`,             // $baseIndex + 1
                            doc.content,                              // $baseIndex + 2
                            doc.relativePath,                         // $baseIndex + 3
                            doc.startLine,                           // $baseIndex + 4
                            doc.endLine,                             // $baseIndex + 5
                            doc.fileExtension,                       // $baseIndex + 6
                            JSON.stringify(doc.metadata)            // $baseIndex + 7
                            // $baseIndex + 8 is the tsvector generated inline
                        );
                    });

                    const batchInsertQuery = `
                        INSERT INTO ${tableName} 
                        (id, vector, content, relative_path, start_line, end_line, file_extension, metadata, content_tsvector)
                        VALUES ${valuesClauses.join(', ')}
                        ON CONFLICT (id) DO UPDATE SET
                            vector = EXCLUDED.vector,
                            content = EXCLUDED.content,
                            relative_path = EXCLUDED.relative_path,
                            start_line = EXCLUDED.start_line,
                            end_line = EXCLUDED.end_line,
                            file_extension = EXCLUDED.file_extension,
                            metadata = EXCLUDED.metadata,
                            content_tsvector = to_tsvector('english', EXCLUDED.content)
                    `;

                    await client.query(batchInsertQuery, allParams);
                    const batchDuration = Date.now() - batchStartTime;
                    console.log(`✅ Batch inserted ${batch.length} hybrid documents (${i + 1}-${Math.min(i + batchSize, deduplicatedDocs.length)} of ${deduplicatedDocs.length}) in ${batchDuration}ms`);
                }

                await client.query('COMMIT');
                const totalDuration = Date.now() - startTime;
                const docsPerSecond = Math.round((deduplicatedDocs.length / totalDuration) * 1000);
                console.log(`✅ Successfully inserted ${deduplicatedDocs.length} documents into PostgreSQL hybrid collection '${collectionName}' with full-text indexing in ${totalDuration}ms (${docsPerSecond} docs/sec)`);
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error(`❌ Failed to insert hybrid documents into collection '${collectionName}':`, error);
            throw error;
        }
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        await this.ensureInitialized();

        const topK = options?.topK || 10;
        const threshold = options?.threshold || 0.0;

        try {
            const tableName = this.getTableName(collectionName);
            let whereClause = '';
            const queryParams: any[] = [`[${queryVector.join(',')}]`, topK];
            let paramIndex = 3;

            // Add additional filter conditions if provided
            if (options?.filterExpr) {
                whereClause = whereClause ? `${whereClause} AND (${options.filterExpr})` : `WHERE (${options.filterExpr})`;
            }

            // Add threshold filter to WHERE clause
            if (threshold > 0) {
                const thresholdCondition = `1 - (vector <=> $1) >= $${paramIndex++}`;
                whereClause = whereClause ? `${whereClause} AND ${thresholdCondition}` : `WHERE ${thresholdCondition}`;
                queryParams.push(threshold);
            }

            const searchQuery = `
                SELECT 
                    id,
                    content,
                    relative_path,
                    start_line,
                    end_line,
                    file_extension,
                    metadata,
                    1 - (vector <=> $1) AS score
                FROM ${tableName}
                ${whereClause}
                ORDER BY vector <=> $1
                LIMIT $2
            `;

            const result = await this.pool!.query(searchQuery, queryParams);

            return result.rows.map((row: any) => ({
                document: {
                    id: row.id,
                    vector: queryVector,
                    content: row.content,
                    relativePath: row.relative_path,
                    startLine: row.start_line,
                    endLine: row.end_line,
                    fileExtension: row.file_extension,
                    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
                },
                score: parseFloat(row.score)
            }));
        } catch (error) {
            console.error(`❌ Failed to search collection '${collectionName}':`, error);
            throw error;
        }
    }

    async hybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options?: HybridSearchOptions): Promise<HybridSearchResult[]> {
        await this.ensureInitialized();

        const limit = options?.limit || 10;
        const rerankStrategy = options?.rerank?.strategy || 'rrf';
        const rrfK = options?.rerank?.params?.k || 60;
        const tableName = this.getTableName(collectionName);

        console.log(`[PostgresDB] 🔍 Performing hybrid search on collection '${collectionName}' with ${searchRequests.length} search requests`);

        try {
            // Find dense vector search request
            const denseRequest = searchRequests.find(req => req.anns_field === 'vector');
            // Find sparse/text search request  
            const sparseRequest = searchRequests.find(req => req.anns_field === 'sparse_vector');

            if (!denseRequest) {
                throw new Error('Dense vector search request is required for hybrid search');
            }

            let hybridQuery: string;
            let queryParams: any[];

            if (sparseRequest && typeof sparseRequest.data === 'string') {
                console.log(`[PostgresDB] 🔍 Hybrid search: vector + full-text search using ${rerankStrategy} reranking`);

                // Enhanced hybrid search with better full-text search and reranking
                if (rerankStrategy === 'rrf') {
                    // RRF (Reciprocal Rank Fusion) reranking
                    hybridQuery = `
                        WITH vector_search AS (
                            SELECT 
                                id, content, relative_path, start_line, end_line, file_extension, metadata,
                                1 - (vector <=> $1) AS vector_score,
                                ROW_NUMBER() OVER (ORDER BY vector <=> $1) AS vector_rank
                            FROM ${tableName}
                            ORDER BY vector <=> $1
                            LIMIT $2
                        ),
                        text_search AS (
                            SELECT 
                                id, content, relative_path, start_line, end_line, file_extension, metadata,
                                ts_rank_cd(content_tsvector, plainto_tsquery('english', $3), 32) AS text_score,
                                ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsvector, plainto_tsquery('english', $3), 32) DESC) AS text_rank
                            FROM ${tableName}
                            WHERE content_tsvector @@ plainto_tsquery('english', $3)
                            ORDER BY ts_rank_cd(content_tsvector, plainto_tsquery('english', $3), 32) DESC
                            LIMIT $2
                        ),
                        combined AS (
                            SELECT 
                                COALESCE(v.id, t.id) as id,
                                COALESCE(v.content, t.content) as content,
                                COALESCE(v.relative_path, t.relative_path) as relative_path,
                                COALESCE(v.start_line, t.start_line) as start_line,
                                COALESCE(v.end_line, t.end_line) as end_line,
                                COALESCE(v.file_extension, t.file_extension) as file_extension,
                                COALESCE(v.metadata, t.metadata) as metadata,
                                COALESCE(v.vector_score, 0) as vector_score,
                                COALESCE(t.text_score, 0) as text_score,
                                COALESCE(v.vector_rank, 999999) as vector_rank,
                                COALESCE(t.text_rank, 999999) as text_rank,
                                -- RRF Score: 1/(k + rank) for each ranking
                                (1.0 / ($4 + COALESCE(v.vector_rank, 999999))) + 
                                (1.0 / ($4 + COALESCE(t.text_rank, 999999))) as rrf_score
                            FROM vector_search v
                            FULL OUTER JOIN text_search t ON v.id = t.id
                        )
                        SELECT 
                            id, content, relative_path, start_line, end_line, file_extension, metadata,
                            vector_score, text_score, rrf_score as final_score
                        FROM combined
                        ORDER BY rrf_score DESC
                        LIMIT $5
                    `;
                    queryParams = [
                        `[${(denseRequest.data as number[]).join(',')}]`,
                        Math.max(denseRequest.limit, sparseRequest.limit),
                        sparseRequest.data as string,
                        rrfK,
                        limit
                    ];
                } else {
                    // Weighted reranking
                    const vectorWeight = options?.rerank?.params?.vector_weight || 0.7;
                    const textWeight = options?.rerank?.params?.text_weight || 0.3;

                    hybridQuery = `
                        WITH vector_search AS (
                            SELECT 
                                id, content, relative_path, start_line, end_line, file_extension, metadata,
                                1 - (vector <=> $1) AS vector_score
                            FROM ${tableName}
                            ORDER BY vector <=> $1
                            LIMIT $2
                        ),
                        text_search AS (
                            SELECT 
                                id, content, relative_path, start_line, end_line, file_extension, metadata,
                                ts_rank_cd(content_tsvector, plainto_tsquery('english', $3), 32) AS text_score
                            FROM ${tableName}
                            WHERE content_tsvector @@ plainto_tsquery('english', $3)
                            ORDER BY ts_rank_cd(content_tsvector, plainto_tsquery('english', $3), 32) DESC
                            LIMIT $2
                        ),
                        combined AS (
                            SELECT 
                                COALESCE(v.id, t.id) as id,
                                COALESCE(v.content, t.content) as content,
                                COALESCE(v.relative_path, t.relative_path) as relative_path,
                                COALESCE(v.start_line, t.start_line) as start_line,
                                COALESCE(v.end_line, t.end_line) as end_line,
                                COALESCE(v.file_extension, t.file_extension) as file_extension,
                                COALESCE(v.metadata, t.metadata) as metadata,
                                COALESCE(v.vector_score, 0) as vector_score,
                                COALESCE(t.text_score, 0) as text_score,
                                -- Weighted combination
                                COALESCE(v.vector_score, 0) * $4 + COALESCE(t.text_score, 0) * $5 as weighted_score
                            FROM vector_search v
                            FULL OUTER JOIN text_search t ON v.id = t.id
                        )
                        SELECT 
                            id, content, relative_path, start_line, end_line, file_extension, metadata,
                            vector_score, text_score, weighted_score as final_score
                        FROM combined
                        ORDER BY weighted_score DESC
                        LIMIT $6
                    `;
                    queryParams = [
                        `[${(denseRequest.data as number[]).join(',')}]`,
                        Math.max(denseRequest.limit, sparseRequest.limit),
                        sparseRequest.data as string,
                        vectorWeight,
                        textWeight,
                        limit
                    ];
                }
            } else {
                console.log(`[PostgresDB] 🔍 Vector-only search (no text query provided)`);
                // Fallback to dense vector search only
                hybridQuery = `
                    SELECT 
                        id, content, relative_path, start_line, end_line, file_extension, metadata,
                        1 - (vector <=> $1) AS final_score
                    FROM ${tableName}
                    ORDER BY vector <=> $1
                    LIMIT $2
                `;
                queryParams = [
                    `[${(denseRequest.data as number[]).join(',')}]`,
                    limit
                ];
            }

            // Add filter expression if provided
            if (options?.filterExpr && options.filterExpr.trim()) {
                // For CTE queries, add WHERE clause if not present, or extend existing WHERE
                if (hybridQuery.includes('WHERE content_tsvector')) {
                    hybridQuery = hybridQuery.replace(
                        /WHERE content_tsvector/g,
                        `WHERE (${options.filterExpr}) AND content_tsvector`
                    );
                } else {
                    // For simple queries or queries without WHERE clauses, add WHERE
                    hybridQuery = hybridQuery.replace(
                        /ORDER BY/g,
                        `WHERE (${options.filterExpr}) ORDER BY`
                    );
                }
            }

            console.log(`[PostgresDB] 🔍 Executing hybrid search query with ${queryParams.length} parameters`);
            const result = await this.pool!.query(hybridQuery, queryParams);

            console.log(`[PostgresDB] ✅ Hybrid search completed: ${result.rows.length} results found`);

            return result.rows.map((row: any) => ({
                document: {
                    id: row.id,
                    vector: denseRequest.data as number[],
                    content: row.content,
                    relativePath: row.relative_path,
                    startLine: row.start_line,
                    endLine: row.end_line,
                    fileExtension: row.file_extension,
                    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
                },
                score: parseFloat(row.final_score)
            }));
        } catch (error) {
            console.error(`❌ Failed to perform hybrid search on collection '${collectionName}':`, error);
            throw error;
        }
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        await this.ensureInitialized();

        const tableName = this.getTableName(collectionName);

        if (ids.length === 0) {
            return;
        }

        try {
            const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
            const deleteQuery = `DELETE FROM ${tableName} WHERE id IN (${placeholders})`;

            const result = await this.pool!.query(deleteQuery, ids);
            console.log(`✅ Deleted ${result.rowCount} documents from PostgreSQL collection '${collectionName}'`);
        } catch (error) {
            console.error(`❌ Failed to delete documents from collection '${collectionName}':`, error);
            throw error;
        }
    }

    async query(collectionName: string, filter: string, outputFields: string[], limit?: number): Promise<Record<string, any>[]> {
        await this.ensureInitialized();

        const queryLimit = limit || 100;

        try {
            // Map output fields to database columns
            const fieldMapping: Record<string, string> = {
                'id': 'id',
                'content': 'content',
                'relativePath': 'relative_path',
                'startLine': 'start_line',
                'endLine': 'end_line',
                'fileExtension': 'file_extension',
                'metadata': 'metadata'
            };

            const dbFields = outputFields.map(field => fieldMapping[field] || field);
            const selectClause = dbFields.length > 0 ? dbFields.join(', ') : '*';

            const tableName = this.getTableName(collectionName);
            let queryText = `SELECT ${selectClause} FROM ${tableName}`;
            const queryParams: any[] = [];

            if (filter && filter.trim()) {
                queryText += ` WHERE (${filter})`;
            }

            queryText += ` LIMIT $${queryParams.length + 1}`;
            queryParams.push(queryLimit);

            const result = await this.pool!.query(queryText, queryParams);

            return result.rows.map(row => {
                const mapped: Record<string, any> = {};
                for (const [originalField, dbField] of Object.entries(fieldMapping)) {
                    if (outputFields.includes(originalField) && row[dbField] !== undefined) {
                        mapped[originalField] = row[dbField];
                    }
                }
                return mapped;
            });
        } catch (error) {
            console.error(`❌ Failed to query collection '${collectionName}':`, error);
            throw error;
        }
    }

    async checkCollectionLimit(): Promise<boolean> {
        await this.ensureInitialized();

        try {
            // PostgreSQL doesn't have collection limits like cloud services
            // Check if we can create a test table (basic connectivity test)
            const testTableName = 'claude_context_limit_test_' + Date.now();
            await this.pool!.query(`CREATE TEMP TABLE ${testTableName} (id TEXT)`);
            await this.pool!.query(`DROP TABLE ${testTableName}`);
            return true;
        } catch (error) {
            console.error('❌ Failed to check collection limit:', error);
            return false;
        }
    }

    async getCollectionStats(collectionName: string): Promise<{ entityCount: number }> {
        await this.ensureInitialized();
        const tableName = this.getTableName(collectionName);

        try {
            const result = await this.pool!.query(
                `SELECT COUNT(*) as count FROM ${tableName}`
            );
            return {
                entityCount: parseInt(result.rows[0].count)
            };
        } catch (error) {
            console.error(`❌ Failed to get collection stats for '${collectionName}':`, error);
            throw error;
        }
    }


    /**
     * Clean up resources
     */
    async close(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            console.log('🔌 PostgreSQL connection pool closed');
        }
    }
}
