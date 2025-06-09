import { MilvusClient, DataType, MetricType } from '@zilliz/milvus2-sdk-node';
import {
    VectorDatabase,
    VectorDocument,
    SearchOptions,
    VectorSearchResult
} from './index';

export interface MilvusConfig {
    address: string;
    username?: string;
    password?: string;
    token?: string;
    ssl?: boolean;
}

export class MilvusVectorDatabase implements VectorDatabase {
    private client: MilvusClient;
    private config: MilvusConfig;

    constructor(config: MilvusConfig) {
        this.config = config;
        this.client = new MilvusClient({
            address: config.address,
            username: config.username,
            password: config.password,
            token: config.token,
            ssl: config.ssl || false,
        });
    }



    async createCollection(collectionName: string, dimension: number, description?: string): Promise<void> {

        const schema = [
            {
                name: 'id',
                description: 'Document ID',
                data_type: DataType.VarChar,
                max_length: 512,
                is_primary_key: true,
            },
            {
                name: 'vector',
                description: 'Embedding vector',
                data_type: DataType.FloatVector,
                dim: dimension,
            },
            {
                name: 'content',
                description: 'Document content',
                data_type: DataType.VarChar,
                max_length: 65535,
            },
            {
                name: 'metadata',
                description: 'Document metadata as JSON string',
                data_type: DataType.VarChar,
                max_length: 65535,
            },
        ];

        const createCollectionParams = {
            collection_name: collectionName,
            description: description || `Code indexer collection: ${collectionName}`,
            fields: schema,
        };

        await this.client.createCollection(createCollectionParams);

        // Create index
        const indexParams = {
            collection_name: collectionName,
            field_name: 'vector',
            index_type: 'IVF_FLAT',
            metric_type: MetricType.COSINE,
            params: { nlist: 1024 },
        };

        await this.client.createIndex(indexParams);

        // Load collection to memory
        await this.client.loadCollection({
            collection_name: collectionName,
        });

        // Verify collection is created correctly
        await this.client.describeCollection({
            collection_name: collectionName,
        });
    }

    async dropCollection(collectionName: string): Promise<void> {
        await this.client.dropCollection({
            collection_name: collectionName,
        });
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        const result = await this.client.hasCollection({
            collection_name: collectionName,
        });

        return Boolean(result.value);
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {

        const data = documents.map(doc => ({
            id: doc.id,
            vector: doc.vector,
            content: doc.content,
            metadata: JSON.stringify(doc.metadata),
        }));

        await this.client.insert({
            collection_name: collectionName,
            data: data,
        });
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {

        const searchParams = {
            collection_name: collectionName,
            data: [queryVector], // Use data instead of vectors
            limit: options?.topK || 10, // Use limit instead of topk
            output_fields: ['id', 'content', 'metadata'],
        };

        const searchResult = await this.client.search(searchParams);

        if (!searchResult.results || searchResult.results.length === 0) {
            return [];
        }

        return searchResult.results.map((result: any) => ({
            document: {
                id: result.id,
                vector: queryVector, // Original query vector
                content: result.content,
                metadata: JSON.parse(result.metadata || '{}'),
            },
            score: result.score,
        }));
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        await this.client.delete({
            collection_name: collectionName,
            filter: `id in [${ids.map(id => `"${id}"`).join(', ')}]`,
        });
    }



} 