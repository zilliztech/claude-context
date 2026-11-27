import { MilvusVectorDatabase } from './milvus-vectordb';

const successStatus = { error_code: 'Success', reason: '' };
const numericSuccessStatus = { error_code: 0, reason: '' };

type MockStatus = { error_code: string | number; reason: string };

type MockMilvusClient = {
    createCollection: jest.Mock;
    createIndex: jest.Mock;
    getIndexBuildProgress: jest.Mock;
    loadCollection: jest.Mock;
    describeCollection: jest.Mock;
};

function createDatabase(
    indexResults: MockStatus[],
    progressResults: Array<{
        indexed_rows: string;
        total_rows: string;
        status: MockStatus;
    }>,
): { database: MilvusVectorDatabase; client: MockMilvusClient } {
    const client: MockMilvusClient = {
        createCollection: jest.fn().mockResolvedValue(successStatus),
        createIndex: jest.fn(),
        getIndexBuildProgress: jest.fn(),
        loadCollection: jest.fn().mockResolvedValue(successStatus),
        describeCollection: jest.fn().mockResolvedValue({}),
    };

    for (const result of indexResults) {
        client.createIndex.mockResolvedValueOnce(result);
    }
    for (const result of progressResults) {
        client.getIndexBuildProgress.mockResolvedValueOnce(result);
    }

    const database = Object.create(MilvusVectorDatabase.prototype) as MilvusVectorDatabase;
    Object.assign(database as unknown as {
        client: MockMilvusClient;
        initializationPromise: Promise<void>;
    }, {
        client,
        initializationPromise: Promise.resolve(),
    });

    return { database, client };
}

describe('MilvusVectorDatabase hybrid index creation', () => {
    it.each([
        {
            fieldName: 'vector',
            indexResults: [
                { error_code: 'UnexpectedError', reason: 'dense index rejected' },
                successStatus,
            ],
            progressResults: [
                {
                    indexed_rows: '0',
                    total_rows: '0',
                    status: { error_code: 'IndexNotExist', reason: 'dense index is missing' },
                },
                { indexed_rows: '0', total_rows: '0', status: successStatus },
            ],
            reason: 'dense index rejected',
        },
        {
            fieldName: 'sparse_vector',
            indexResults: [
                successStatus,
                { error_code: 'UnexpectedError', reason: 'sparse index rejected' },
            ],
            progressResults: [
                { indexed_rows: '0', total_rows: '0', status: successStatus },
                {
                    indexed_rows: '0',
                    total_rows: '0',
                    status: { error_code: 'IndexNotExist', reason: 'sparse index is missing' },
                },
            ],
            reason: 'sparse index rejected',
        },
    ])('rejects a failed $fieldName createIndex response', async ({ indexResults, progressResults, reason }) => {
        const { database, client } = createDatabase(indexResults, progressResults);

        await expect(database.createHybridCollection('test_collection', 3)).rejects.toThrow(reason);
        expect(client.loadCollection).not.toHaveBeenCalled();
    });

    it('does not treat an index error with zero progress as ready', async () => {
        const { database, client } = createDatabase(
            [successStatus, successStatus],
            [
                { indexed_rows: '0', total_rows: '0', status: successStatus },
                {
                    indexed_rows: '0',
                    total_rows: '0',
                    status: {
                        error_code: 'IndexNotExist',
                        reason: 'there is no vector index on field: [sparse_vector]',
                    },
                },
            ],
        );

        await expect(database.createHybridCollection('test_collection', 3))
            .rejects
            .toThrow('there is no vector index on field: [sparse_vector]');
        expect(client.loadCollection).not.toHaveBeenCalled();
    });

    it('accepts numeric zero as a successful Milvus status', async () => {
        const { database, client } = createDatabase(
            [numericSuccessStatus, numericSuccessStatus],
            [
                { indexed_rows: '0', total_rows: '0', status: numericSuccessStatus },
                { indexed_rows: '0', total_rows: '0', status: numericSuccessStatus },
            ],
        );

        await expect(database.createHybridCollection('test_collection', 3)).resolves.toBeUndefined();
        expect(client.createIndex).toHaveBeenCalledTimes(2);
        expect(client.loadCollection).toHaveBeenCalledTimes(1);
        expect(client.describeCollection).toHaveBeenCalledTimes(1);
    });
});
