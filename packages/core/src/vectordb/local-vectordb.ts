import {
    VectorDocument,
    SearchOptions,
    VectorSearchResult,
    VectorDatabase,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult
} from './types.js';
import * as sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { IndexFlatIP, IndexFlatL2, MetricType } from 'faiss-node';

export interface LocalVectorDatabaseConfig {
    dataDir?: string;
}

interface VectorIndex {
    dimension: number;
    index: IndexFlatIP | IndexFlatL2;
    idMapping: Map<number, string>;
    reverseIdMapping: Map<string, number>;
    nextId: number;
}

export class LocalVectorDatabase implements VectorDatabase {
    private config: LocalVectorDatabaseConfig;
    private dbPromise: Promise<Database<sqlite3.Database, sqlite3.Statement>> | null = null;
    private vectorIndices: Map<string, VectorIndex> = new Map();
    private dataDir: string;

    constructor(config: LocalVectorDatabaseConfig = {}) {
        this.config = config;
        const homeDir = require('os').homedir();
        this.dataDir = config.dataDir || path.join(homeDir, '.claude-context', 'local-db');
        
        // Ensure data directory exists
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        
        console.log(`[LocalDB] Using data directory: ${this.dataDir}`);
    }

    private async getDb(): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
        if (!this.dbPromise) {
            this.dbPromise = this.initDb();
        }
        return this.dbPromise;
    }

    private async initDb(): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
        const dbPath = path.join(this.dataDir, 'documents.db');
        const db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        // Create collections table
        await db.exec(`
            CREATE TABLE IF NOT EXISTS collections (
                name TEXT PRIMARY KEY,
                dimension INTEGER NOT NULL,
                description TEXT,
                is_hybrid BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create documents table
        await db.exec(`
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                collection_name TEXT NOT NULL,
                content TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                file_extension TEXT NOT NULL,
                metadata TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (collection_name) REFERENCES collections(name) ON DELETE CASCADE
            )
        `);

        // Create FTS5 virtual table for full-text search
        await db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                id,
                content,
                relative_path,
                file_extension,
                content_rowid = rowid
            )
        `);

        // Create indexes
        await db.exec(`
            CREATE INDEX IF NOT EXISTS idx_docs_collection ON documents(collection_name);
            CREATE INDEX IF NOT EXISTS idx_docs_rel_path ON documents(relative_path);
            CREATE INDEX IF NOT EXISTS idx_docs_extension ON documents(file_extension);
        `);

        return db;
    }

    private getVectorIndexPath(collectionName: string): string {
        return path.join(this.dataDir, `${collectionName}.faiss`);
    }

    private async saveVectorIndex(collectionName: string): Promise<void> {
        const indexData = this.vectorIndices.get(collectionName);
        if (!indexData) return;
        
        const indexPath = this.getVectorIndexPath(collectionName);
        const metadataPath = indexPath + '.meta';
        
        // Save FAISS index
        indexData.index.write(indexPath);
        
        // Save metadata
        const metadata = {
            dimension: indexData.dimension,
            idMapping: Array.from(indexData.idMapping.entries()),
            reverseIdMapping: Array.from(indexData.reverseIdMapping.entries()),
            nextId: indexData.nextId
        };
        
        fs.writeFileSync(metadataPath, JSON.stringify(metadata));
    }

    private async loadVectorIndex(collectionName: string, dimension: number): Promise<VectorIndex> {
        const indexPath = this.getVectorIndexPath(collectionName);
        const metadataPath = indexPath + '.meta';
        
        if (fs.existsSync(indexPath) && fs.existsSync(metadataPath)) {
            try {
                const index = IndexFlatIP.read(indexPath);
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
                
                const vectorIndex: VectorIndex = {
                    dimension,
                    index,
                    idMapping: new Map(metadata.idMapping),
                    reverseIdMapping: new Map(metadata.reverseIdMapping),
                    nextId: metadata.nextId
                };
                
                this.vectorIndices.set(collectionName, vectorIndex);
                return vectorIndex;
            } catch (error) {
                console.warn(`[LocalDB] Failed to load existing index for ${collectionName}, creating new one`);
            }
        }
        
        // Create new index
        const index = new IndexFlatIP(dimension);
        const vectorIndex: VectorIndex = {
            dimension,
            index,
            idMapping: new Map(),
            reverseIdMapping: new Map(),
            nextId: 0
        };
        
        this.vectorIndices.set(collectionName, vectorIndex);
        return vectorIndex;
    }

    async createCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        const db = await this.getDb();
        
        // Insert collection metadata
        await db.run(
            'INSERT OR REPLACE INTO collections (name, dimension, description, is_hybrid) VALUES (?, ?, ?, 0)',
            [collectionName, dimension, description || '']
        );
        
        // Initialize vector index
        await this.loadVectorIndex(collectionName, dimension);
        
        console.log(`[LocalDB] Created collection: ${collectionName} (dimension: ${dimension})`);
    }

    async createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        const db = await this.getDb();
        
        // Insert collection metadata with hybrid flag
        await db.run(
            'INSERT OR REPLACE INTO collections (name, dimension, description, is_hybrid) VALUES (?, ?, ?, 1)',
            [collectionName, dimension, description || '']
        );
        
        // Initialize vector index
        await this.loadVectorIndex(collectionName, dimension);
        
        console.log(`[LocalDB] Created hybrid collection: ${collectionName} (dimension: ${dimension})`);
    }

    async dropCollection(collectionName: string): Promise<void> {
        const db = await this.getDb();
        
        // Delete from database
        await db.run('DELETE FROM collections WHERE name = ?', [collectionName]);
        
        // Delete index files
        const indexPath = this.getVectorIndexPath(collectionName);
        const metadataPath = indexPath + '.meta';
        
        if (fs.existsSync(indexPath)) {
            fs.unlinkSync(indexPath);
        }
        if (fs.existsSync(metadataPath)) {
            fs.unlinkSync(metadataPath);
        }
        
        // Remove from memory
        this.vectorIndices.delete(collectionName);
        
        console.log(`[LocalDB] Dropped collection: ${collectionName}`);
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        const db = await this.getDb();
        const result = await db.get(
            'SELECT 1 FROM collections WHERE name = ?',
            [collectionName]
        );
        return !!result;
    }

    async listCollections(): Promise<string[]> {
        const db = await this.getDb();
        const results = await db.all('SELECT name FROM collections');
        return results.map(r => r.name);
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        const db = await this.getDb();
        const vectorIndex = await this.loadVectorIndex(collectionName, documents[0]?.vector.length || 0);
        
        for (const doc of documents) {
            // Add to vector index
            const faissId = vectorIndex.nextId++;
            vectorIndex.index.add(doc.vector);
            vectorIndex.idMapping.set(faissId, doc.id);
            vectorIndex.reverseIdMapping.set(doc.id, faissId);
            
            // Insert into SQLite
            await db.run(`
                INSERT OR REPLACE INTO documents 
                (id, collection_name, content, relative_path, start_line, end_line, file_extension, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                doc.id,
                collectionName,
                doc.content,
                doc.relativePath,
                doc.startLine,
                doc.endLine,
                doc.fileExtension,
                JSON.stringify(doc.metadata)
            ]);
            
            // Insert into FTS
            await db.run(`
                INSERT OR REPLACE INTO documents_fts (rowid, id, content, relative_path, file_extension)
                VALUES ((SELECT rowid FROM documents WHERE id = ?), ?, ?, ?, ?)
            `, [doc.id, doc.id, doc.content, doc.relativePath, doc.fileExtension]);
        }
        
        await this.saveVectorIndex(collectionName);
        console.log(`[LocalDB] Inserted ${documents.length} documents into ${collectionName}`);
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        // For local DB, hybrid search uses same storage but combines vector search with FTS
        await this.insert(collectionName, documents);
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        const db = await this.getDb();
        const vectorIndex = await this.loadVectorIndex(collectionName, queryVector.length);
        
        const topK = options?.topK || 10;
        
        // Perform vector search
        const result = vectorIndex.index.search(queryVector, topK) as any;
        const distances = result.distances || result.distance;
        const indices = result.indices || result.labels;
        
        const results: VectorSearchResult[] = [];
        
        for (let i = 0; i < indices.length; i++) {
            const faissId = indices[i];
            const docId = vectorIndex.idMapping.get(faissId);
            
            if (!docId) continue;
            
            const doc = await db.get(
                'SELECT * FROM documents WHERE id = ?',
                [docId]
            );
            
            if (doc) {
                results.push({
                    document: {
                        id: doc.id,
                        vector: queryVector,
                        content: doc.content,
                        relativePath: doc.relative_path,
                        startLine: doc.start_line,
                        endLine: doc.end_line,
                        fileExtension: doc.file_extension,
                        metadata: JSON.parse(doc.metadata)
                    },
                    score: distances[i]
                });
            }
        }
        
        // Apply threshold filter if specified
        if (options && options.threshold !== undefined) {
            return results.filter(r => r.score >= options.threshold!);
        }
        
        return results;
    }

    async hybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options?: HybridSearchOptions): Promise<HybridSearchResult[]> {
        const db = await this.getDb();
        
        const denseRequest = searchRequests.find(r => r.anns_field === 'vector');
        const sparseRequest = searchRequests.find(r => r.anns_field === 'sparse_vector');
        
        const topK = options?.limit || 10;
        
        // Get dense results
        let denseResults: VectorSearchResult[] = [];
        if (denseRequest && Array.isArray(denseRequest.data)) {
            denseResults = await this.search(collectionName, denseRequest.data, { topK: topK * 2 });
        }
        
        // Get sparse (full-text) results
        let sparseResults: VectorSearchResult[] = [];
        if (sparseRequest && typeof sparseRequest.data === 'string') {
            const ftsResults = await db.all(`
                SELECT 
                    d.*,
                    rank
                FROM documents_fts fts
                JOIN documents d ON fts.id = d.id
                WHERE documents_fts MATCH ?
                AND d.collection_name = ?
                ORDER BY rank
                LIMIT ?
            `, [sparseRequest.data, collectionName, topK * 2]);
            
            sparseResults = ftsResults.map(doc => ({
                document: {
                    id: doc.id,
                    vector: [],
                    content: doc.content,
                    relativePath: doc.relative_path,
                    startLine: doc.start_line,
                    endLine: doc.end_line,
                    fileExtension: doc.file_extension,
                    metadata: JSON.parse(doc.metadata)
                },
                score: Math.max(0, 1 - doc.rank / 1000) // Normalize rank to score
            }));
        }
        
        // Combine and rerank using RRF (Reciprocal Rank Fusion)
        const combinedScores = new Map<string, { doc: VectorDocument, score: number }>();
        
        // Add dense results with RRF
        denseResults.forEach((result, idx) => {
            const rrfScore = 1 / (idx + 60);
            const existing = combinedScores.get(result.document.id);
            if (existing) {
                existing.score += rrfScore;
            } else {
                combinedScores.set(result.document.id, { doc: result.document, score: rrfScore });
            }
        });
        
        // Add sparse results with RRF
        sparseResults.forEach((result, idx) => {
            const rrfScore = 1 / (idx + 60);
            const existing = combinedScores.get(result.document.id);
            if (existing) {
                existing.score += rrfScore;
            } else {
                combinedScores.set(result.document.id, { doc: result.document, score: rrfScore });
            }
        });
        
        // Sort and take top K
        const sortedResults = Array.from(combinedScores.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)
            .map(({ doc, score }) => ({ document: doc, score }));
        
        return sortedResults;
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        const db = await this.getDb();
        const vectorIndex = this.vectorIndices.get(collectionName);
        
        if (vectorIndex) {
            // Note: FAISS doesn't support efficient deletion of individual vectors
            // We'll just remove them from our mapping
            for (const id of ids) {
                const faissId = vectorIndex.reverseIdMapping.get(id);
                if (faissId !== undefined) {
                    vectorIndex.idMapping.delete(faissId);
                    vectorIndex.reverseIdMapping.delete(id);
                }
            }
            await this.saveVectorIndex(collectionName);
        }
        
        // Delete from SQLite
        for (const id of ids) {
            await db.run('DELETE FROM documents WHERE id = ?', [id]);
            await db.run('DELETE FROM documents_fts WHERE id = ?', [id]);
        }
        
        console.log(`[LocalDB] Deleted ${ids.length} documents from ${collectionName}`);
    }

    async query(collectionName: string, filter: string, outputFields: string[], limit?: number): Promise<Record<string, any>[]> {
        const db = await this.getDb();
        
        let whereClause = 'collection_name = ?';
        const params: any[] = [collectionName];
        
        if (filter && filter.trim()) {
            whereClause += ` AND ${filter}`;
        }
        
        const fieldMapping: Record<string, string> = {
            'id': 'id',
            'content': 'content',
            'relativePath': 'relative_path',
            'startLine': 'start_line',
            'endLine': 'end_line',
            'fileExtension': 'file_extension',
            'metadata': 'metadata'
        };
        
        const mappedFields = outputFields.map(f => fieldMapping[f] || f).join(', ');
        
        let query = `SELECT ${mappedFields} FROM documents WHERE ${whereClause}`;
        if (limit) {
            query += ` LIMIT ${limit}`;
        }
        
        const results = await db.all(query, params);
        
        // Map back to camelCase
        return results.map(row => {
            const mapped: Record<string, any> = {};
            for (const [key, value] of Object.entries(row)) {
                const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
                mapped[camelKey] = value;
            }
            return mapped;
        });
    }

    async getCollectionDescription(collectionName: string): Promise<string> {
        const db = await this.getDb();
        const result = await db.get(
            'SELECT description FROM collections WHERE name = ?',
            [collectionName]
        );
        return result?.description || '';
    }

    async checkCollectionLimit(): Promise<boolean> {
        // No collection limit for local DB
        return true;
    }

    async getCollectionRowCount(collectionName: string): Promise<number> {
        const db = await this.getDb();
        const result = await db.get(
            'SELECT COUNT(*) as count FROM documents WHERE collection_name = ?',
            [collectionName]
        );
        return result?.count || 0;
    }
}
