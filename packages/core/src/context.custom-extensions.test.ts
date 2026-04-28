import { Context } from './context';
import { VectorDatabase } from './vectordb';

const createVectorDatabase = (): VectorDatabase => ({
    createCollection: jest.fn(),
    createHybridCollection: jest.fn(),
    dropCollection: jest.fn(),
    hasCollection: jest.fn(),
    listCollections: jest.fn(),
    insert: jest.fn(),
    insertHybrid: jest.fn(),
    search: jest.fn(),
    hybridSearch: jest.fn(),
    delete: jest.fn(),
    query: jest.fn(),
    getCollectionDescription: jest.fn(),
    checkCollectionLimit: jest.fn(),
    getCollectionRowCount: jest.fn(),
});

describe('Context request-level supported extension isolation', () => {
    it('does not leak request-level custom extensions into shared Context state', () => {
        const context = new Context({ vectorDatabase: createVectorDatabase() });
        const baseline = context.getSupportedExtensions();

        const projectAExtensions = context.getEffectiveSupportedExtensions(['.foo']);
        expect(projectAExtensions).toContain('.foo');

        // Subsequent calls without per-request extensions must not see project A's '.foo'.
        const projectBExtensions = context.getEffectiveSupportedExtensions();
        expect(projectBExtensions).not.toContain('.foo');
        expect(projectBExtensions).toEqual(baseline);

        // The Context's own supportedExtensions must remain untouched.
        expect(context.getSupportedExtensions()).toEqual(baseline);
    });

    it('normalizes extensions without a leading dot', () => {
        const context = new Context({ vectorDatabase: createVectorDatabase() });

        const effective = context.getEffectiveSupportedExtensions(['foo', '.bar']);
        expect(effective).toContain('.foo');
        expect(effective).toContain('.bar');
    });

    it('deduplicates extensions already in the persistent list', () => {
        const context = new Context({
            vectorDatabase: createVectorDatabase(),
            customExtensions: ['.bar'],
        });

        const effective = context.getEffectiveSupportedExtensions(['.bar', 'baz']);
        const occurrences = effective.filter(ext => ext === '.bar').length;
        expect(occurrences).toBe(1);
        expect(effective).toContain('.baz');
    });

    it('persistent customExtensions on the Context still apply to every request', () => {
        const context = new Context({
            vectorDatabase: createVectorDatabase(),
            customExtensions: ['.persistent'],
        });

        // No request-level additions: persistent ones must still be present.
        const effectiveA = context.getEffectiveSupportedExtensions();
        expect(effectiveA).toContain('.persistent');

        // With request-level additions: persistent ones must remain present.
        const effectiveB = context.getEffectiveSupportedExtensions(['.req']);
        expect(effectiveB).toContain('.persistent');
        expect(effectiveB).toContain('.req');
    });

    it('returns a defensive copy so callers cannot mutate Context state', () => {
        const context = new Context({ vectorDatabase: createVectorDatabase() });

        const effective = context.getEffectiveSupportedExtensions(['.foo']);
        effective.push('.tampered');

        // Re-querying must not surface the caller's local mutation, and must
        // not include the prior request's '.foo' either (no leak).
        const reQueried = context.getEffectiveSupportedExtensions();
        expect(reQueried).not.toContain('.tampered');
        expect(reQueried).not.toContain('.foo');
    });
});
