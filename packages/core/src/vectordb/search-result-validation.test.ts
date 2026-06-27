import {
    VectorSearchResultValidationError,
    validateMilvusSearchResultRow
} from './search-result-validation';

describe('validateMilvusSearchResultRow', () => {
    it('rejects null result entries with actionable diagnostics', () => {
        expect(() => validateMilvusSearchResultRow(null, 'code_chunks', 0)).toThrow(VectorSearchResultValidationError);
        expect(() => validateMilvusSearchResultRow(null, 'code_chunks', 0)).toThrow(/Malformed Milvus search result/);
        expect(() => validateMilvusSearchResultRow(null, 'code_chunks', 0)).toThrow(/code_chunks/);
        expect(() => validateMilvusSearchResultRow(null, 'code_chunks', 0)).toThrow(/embedding dimension mismatch/);
        expect(() => validateMilvusSearchResultRow(null, 'code_chunks', 0)).toThrow(/collection mismatch/);
    });

    it('rejects missing, null, and non-numeric score fields', () => {
        for (const row of [{ id: 'a' }, { id: 'a', score: null }, { id: 'a', score: '0.9' }]) {
            expect(() => validateMilvusSearchResultRow(row, 'code_chunks', 1)).toThrow(/Missing numeric score field/);
        }
    });

    it('accepts configured numeric score fields', () => {
        expect(validateMilvusSearchResultRow({ id: 'a', distance: 0 }, 'code_chunks', 0, ['distance'])).toEqual({
            id: 'a',
            distance: 0,
        });
    });
});
