import { MilvusVectorDatabase } from './milvus-vectordb';
import { VectorSearchResultValidationError } from './search-result-validation';

function createDatabaseWithSearchResults(results: unknown[]): MilvusVectorDatabase {
    const database = Object.create(MilvusVectorDatabase.prototype) as MilvusVectorDatabase;
    (database as any).initializationPromise = Promise.resolve();
    (database as any).client = {
        getLoadState: jest.fn().mockResolvedValue({ state: 'LoadStateLoaded' }),
        search: jest.fn().mockResolvedValue({ results }),
    };
    return database;
}

describe('MilvusVectorDatabase search result validation', () => {
    it('rejects null result entries before mapping scores', async () => {
        const database = createDatabaseWithSearchResults([null]);

        await expect(database.search('code_chunks', [0.1, 0.2, 0.3])).rejects.toThrow(VectorSearchResultValidationError);
        await expect(database.search('code_chunks', [0.1, 0.2, 0.3])).rejects.toThrow(/Malformed Milvus search result/);
        await expect(database.search('code_chunks', [0.1, 0.2, 0.3])).rejects.toThrow(/code_chunks/);
        await expect(database.search('code_chunks', [0.1, 0.2, 0.3])).rejects.toThrow(/embedding dimension mismatch/);
        await expect(database.search('code_chunks', [0.1, 0.2, 0.3])).rejects.toThrow(/collection mismatch/);
    });

    it('rejects null scores before returning mapped search results', async () => {
        const database = createDatabaseWithSearchResults([{
            id: 'doc-1',
            content: 'const answer = 42;',
            relativePath: 'src/index.ts',
            startLine: 1,
            endLine: 1,
            fileExtension: '.ts',
            metadata: '{}',
            score: null,
        }]);

        await expect(database.search('code_chunks', [0.1, 0.2, 0.3])).rejects.toThrow(VectorSearchResultValidationError);
        await expect(database.search('code_chunks', [0.1, 0.2, 0.3])).rejects.toThrow(/Missing numeric score field/);
    });
});
