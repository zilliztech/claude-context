// TODO: Install chromadb dependency first
// import { ChromaClient, Collection, Metadata, Where, WhereDocument, Include, CloudClient } from 'chromadb';

// Temporary type definitions until chromadb is installed
type Collection = any;
type Metadata = Record<string, any>;
type Where = Record<string, any>;
type WhereDocument = Record<string, any>;
type Include = string[];

class CloudClient {
    constructor(config: any) { }
}

// Temporary ChromaClient class
class ChromaClientClass {
    constructor(config: any) { }
}
import {
    VectorDocument,
    SearchOptions,
    VectorSearchResult,
    VectorDatabase,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult,
} from './types';
import { ChromaClient } from "chromadb";

export interface ChromaConfig {
    host?: string;
    port?: number;
    ssl?: boolean;
    apiKey?: string;
    tenant?: string;
    database?: string;
    headers?: Record<string, string>;
    fetchOptions?: RequestInit;
}

export class ChromaVectorDatabase implements VectorDatabase {
    protected config: ChromaConfig;
    private client: ChromaClient | null = null;
    protected initializationPromise: Promise<void>;

    constructor(config: ChromaConfig) {
        this.config = config;
        // Start initialization asynchronously without waiting
        this.initializationPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        console.log('🔌 Connecting to Chroma vector database...');

        this.client = new ChromaClient({
            host: this.config.host,
            port: this.config.port
        });
    }

    /**
     * Ensure initialization is complete before method execution
     */
    protected async ensureInitialized(): Promise<void> {
        await this.initializationPromise;
        if (!this.client) {
            throw new Error('ChromaClient is not initialized');
        }
    }

    async createCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('ChromaClient is not initialized after ensureInitialized().');
        }

        console.log('Beginning collection creation:', collectionName);
        console.log('Collection dimension:', dimension);

        try {
            await this.client.createCollection({
                name: collectionName,
                metadata: {
                    description: description || `Claude Context collection: ${collectionName}`,
                    dimension: dimension.toString(),
                },
            });

            console.log(`✅ Collection '${collectionName}' created successfully`);
        } catch (error: any) {
            // If collection already exists, that's fine
            if (error.message && error.message.includes('already exists')) {
                console.log(`ℹ️  Collection '${collectionName}' already exists`);
                return;
            }
            throw error;
        }
    }

    async dropCollection(collectionName: string): Promise<void> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('ChromaClient is not initialized after ensureInitialized().');
        }

        try {
            await this.client.deleteCollection({
                name: collectionName,
            });
            console.log(`🗑️  Collection '${collectionName}' dropped successfully`);
        } catch (error: any) {
            // If collection doesn't exist, that's fine
            if (error.message && error.message.includes('not found')) {
                console.log(`ℹ️  Collection '${collectionName}' does not exist`);
                return;
            }
            throw error;
        }
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('ChromaClient is not initialized after ensureInitialized().');
        }

        try {
            await this.client.getCollection({
                name: collectionName,
            });
            return true;
        } catch (error: any) {
            if (error.message && error.message.includes('not be found')) {
                return false;
            }
            throw error;
        }
    }

    async listCollections(): Promise<string[]> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('ChromaClient is not initialized after ensureInitialized().');
        }

        try {
            // Chroma doesn't have a direct listCollections method in the TypeScript client
            // We'll need to implement this differently or return an empty array
            // For now, we'll return an empty array as Chroma doesn't expose this easily
            console.log('⚠️  Chroma TypeScript client does not support listing collections directly');
            return [];
        } catch (error) {
            console.error('❌ Failed to list collections:', error);
            return [];
        }
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('ChromaClient is not initialized after ensureInitialized().');
        }

        console.log('Inserting documents into collection:', collectionName);

        try {
            const collection = await this.client.getCollection({
                name: collectionName,
            });

            // Remove documents with duplicate IDs by keeping only the first occurrence
            const seenIds = new Set<string>();
            const uniqueDocuments = documents.filter(doc => {
                if (seenIds.has(doc.id)) {
                    return false;
                }
                seenIds.add(doc.id);
                return true;
            });

            // Use the deduplicated documents array going forward
            documents = uniqueDocuments;

            const ids = documents.map(doc => doc.id);
            const embeddings = documents.map(doc => doc.vector);
            const documents_text = documents.map(doc => doc.content);
            const metadatas: Metadata[] = documents.map(doc => ({
                relativePath: doc.relativePath,
                startLine: doc.startLine.toString(),
                endLine: doc.endLine.toString(),
                fileExtension: doc.fileExtension,
                ...doc.metadata,
            }));

            await collection.add({
                ids,
                embeddings,
                documents: documents_text,
                metadatas,
            });

            console.log(`✅ Successfully inserted ${documents.length} documents into collection '${collectionName}'`);
        } catch (error) {
            console.error(`❌ Failed to insert documents into collection '${collectionName}':`, error);
            // Extract chunk ID from error message if present
            throw error;
        }
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('ChromaClient is not initialized after ensureInitialized().');
        }

        try {
            const collection = await this.client.getCollection({
                name: collectionName,
            });

            const searchParams: any = {
                queryEmbeddings: [queryVector],
                nResults: options?.topK || 10,
                include: ['documents', 'metadatas', 'distances'] as any,
            };

            // Apply metadata filter if provided
            if (options?.filter) {
                searchParams.where = this.convertFilterToWhere(options.filter);
            }

            // Apply filter expression if provided (Chroma doesn't support complex expressions like Milvus)
            if (options?.filterExpr && options.filterExpr.trim().length > 0) {
                console.log('⚠️  Chroma does not support complex filter expressions like Milvus. Using basic metadata filtering.');
                // For now, we'll ignore complex filter expressions
            }

            const searchResult = await collection.query(searchParams);

            if (!searchResult.ids || searchResult.ids.length === 0 || !searchResult.ids[0]) {
                return [];
            }

            const results: VectorSearchResult[] = [];
            const firstResultIds = searchResult.ids[0];
            const firstResultDocuments = searchResult.documents?.[0] || [];
            const firstResultMetadatas = searchResult.metadatas?.[0] || [];
            const firstResultDistances = searchResult.distances?.[0] || [];

            for (let i = 0; i < firstResultIds.length; i++) {
                const id = firstResultIds[i];
                const document = firstResultDocuments[i];
                const metadata = firstResultMetadatas[i] as Metadata;
                const distance = firstResultDistances[i];

                if (id && document && metadata) {
                    results.push({
                        document: {
                            id,
                            vector: queryVector, // We don't store the original vector in results
                            content: document,
                            relativePath: metadata.relativePath as string || '',
                            startLine: parseInt(metadata.startLine as string || '0'),
                            endLine: parseInt(metadata.endLine as string || '0'),
                            fileExtension: metadata.fileExtension as string || '',
                            metadata: this.extractCustomMetadata(metadata),
                        },
                        score: distance || 0
                    });
                }
            }

            return results;
        } catch (error) {
            console.error(`❌ Failed to search collection '${collectionName}':`, error);
            throw error;
        }
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('ChromaClient is not initialized after ensureInitialized().');
        }

        try {
            const collection = await this.client.getCollection({
                name: collectionName,
            });

            await collection.delete({
                ids,
            });

            console.log(`🗑️  Successfully deleted ${ids.length} documents from collection '${collectionName}'`);
        } catch (error) {
            console.error(`❌ Failed to delete documents from collection '${collectionName}':`, error);
            throw error;
        }
    }

    async query(collectionName: string, filter: string, outputFields: string[], limit?: number): Promise<Record<string, any>[]> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('ChromaClient is not initialized after ensureInitialized().');
        }

        try {
            const collection = await this.client.getCollection({
                name: collectionName,
            });

            const queryParams: any = {
                limit: limit || 16384,
                include: ['documents', 'metadatas'] as any
            };

            if (filter && filter.trim().length > 0) {
                queryParams.where = JSON.parse(filter);
            }

            const result = await collection.get(queryParams);

            if (!result.ids || result.ids.length === 0) {
                return [];
            }

            const documents = result.documents || [];
            const metadatas = result.metadatas || [];

            return result.ids.map((id: string, index: number) => {
                const doc = documents[index];
                const metadata = metadatas[index] as Metadata;

                return {
                    id,
                    content: doc,
                    relativePath: metadata?.relativePath || '',
                    startLine: parseInt(metadata?.startLine as string || '0'),
                    endLine: parseInt(metadata?.endLine as string || '0'),
                    fileExtension: metadata?.fileExtension || '',
                    metadata: metadata ? this.extractCustomMetadata(metadata) : {},
                };
            });
        } catch (error) {
            console.error(`❌ Failed to query collection '${collectionName}':`, error);
            throw error;
        }
    }

    async createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        // Chroma doesn't support hybrid collections with sparse vectors like Milvus
        // We'll create a regular collection and log a warning
        await this.createCollection(collectionName, dimension, description);
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        // Chroma doesn't support hybrid collections, so we'll use regular insert
        await this.insert(collectionName, documents);
    }

    async hybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options?: HybridSearchOptions): Promise<HybridSearchResult[]> {
        // Chroma doesn't support hybrid search like Milvus
        // We'll use the first search request (dense vector) and log a warning
        if (searchRequests.length === 0) {
            throw new Error('No search requests provided');
        }

        const denseRequest = searchRequests[0];
        if (typeof denseRequest.data === 'string') {
            throw new Error('Chroma hybrid search fallback requires vector data, not text');
        }

        const searchOptions: SearchOptions = {
            topK: denseRequest.limit,
            filterExpr: options?.filterExpr,
        };

        const results = await this.search(collectionName, denseRequest.data, searchOptions);

        // Convert VectorSearchResult to HybridSearchResult
        return results.map(result => ({
            document: result.document,
            score: result.score,
        }));
    }

    async checkCollectionLimit(): Promise<boolean> {
        // Chroma doesn't have collection limits like Zilliz Cloud
        // We'll always return true
        return true;
    }

    async listFilePaths(collectionName: string, batchSize: number = 1024): Promise<Set<string>> {
        // Chroma doesn't support listing file paths directly like Zilliz Cloud
        // We'll return an empty array
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('ChromaClient is not initialized after ensureInitialized().');
        }

        const startTime = Date.now();
        let relativeFilePaths: Set<string> = new Set();

        try {
            let totalRecords = 0;

            try {
                // Try to get the collection
                const collection = await this.client.getCollection({
                    name: collectionName,
                });

                if (!collection) {
                    console.log(`⚠️ Collection ${collectionName} not found, skipping...`);
                    return relativeFilePaths;
                }

                // Get collection count
                const count = await collection.count();
                console.log(`📊 Collection size: ${count} records`);

                if (count === 0) {
                    console.log(`⚠️ Collection ${collectionName} has no records, skipping...`);
                    return relativeFilePaths;
                }

                // Iterate through all records in batches
                let processedRecords = 0;
                let offset = 0;

                while (processedRecords < count) {
                    const batch = await collection.get({
                        limit: batchSize,
                        include: ['documents', 'metadatas'] as any,
                        offset: offset
                    });

                    const records = batch.rows();
                    records.forEach((record: any) => {
                        let relativePath = record.metadata?.relativePath;
                        if (relativePath && !relativeFilePaths.has(relativePath)) {
                            relativeFilePaths.add(relativePath);
                        }
                    });

                    if (batch && batch.ids && batch.ids.length > 0) {
                        processedRecords += batch.ids.length;
                        offset += batch.ids.length;
                    } else {
                        break; // No more records
                    }
                }

                totalRecords += count;
            } catch (error) {
                console.log(`⚠️ Collection ${collectionName} not found or not accessible:`, error);
            }

            const totalTime = Date.now() - startTime;
            console.log(`\n🎉 ChromaDB iteration completed!`);
            console.log(`📊 Summary:`);
            console.log(`   Total records: ${totalRecords}`);
            console.log(`   Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);

            return relativeFilePaths;

        } catch (error) {
            const totalTime = Date.now() - startTime;
            console.error(`❌ Error during ChromaDB iteration after ${totalTime}ms:`, error);
        }

        return relativeFilePaths;
    }

    /**
     * Convert filter object to Chroma Where format
     */
    private convertFilterToWhere(filter: Record<string, any>): Where {
        const where: Where = {};

        for (const [key, value] of Object.entries(filter)) {
            if (Array.isArray(value)) {
                where[key] = { $in: value };
            } else {
                where[key] = value;
            }
        }

        return where;
    }

    /**
     * Extract custom metadata from Chroma metadata, excluding system fields
     */
    private extractCustomMetadata(metadata: Metadata): Record<string, any> {
        const systemFields = ['relativePath', 'startLine', 'endLine', 'fileExtension'];
        const customMetadata: Record<string, any> = {};

        for (const [key, value] of Object.entries(metadata)) {
            if (!systemFields.includes(key)) {
                customMetadata[key] = value;
            }
        }

        return customMetadata;
    }
}