import * as path from 'path';
import {
    parseListInput,
    resolveIndexFolders,
    mergeAndSortResults,
    TaggedResult,
} from './pathUtils';

describe('parseListInput', () => {
    it('splits on commas and newlines, trims, drops empties, dedupes', () => {
        expect(parseListInput('a, b\nc,,a\n  ')).toEqual(['a', 'b', 'c']);
    });
    it('returns [] for empty/whitespace', () => {
        expect(parseListInput('   ')).toEqual([]);
        expect(parseListInput('')).toEqual([]);
    });
});

describe('resolveIndexFolders', () => {
    const root = path.resolve('/work/main');

    it('resolves relative subfolders against the workspace root', () => {
        const r = resolveIndexFolders('sub1, sub2', root);
        expect(r.errors).toEqual([]);
        expect(r.resolved).toEqual([path.join(root, 'sub1'), path.join(root, 'sub2')]);
    });

    it('falls back to [root] when input is empty', () => {
        const r = resolveIndexFolders('', root);
        expect(r.resolved).toEqual([root]);
        expect(r.errors).toEqual([]);
    });

    it('treats the root itself as valid', () => {
        const r = resolveIndexFolders('.', root);
        expect(r.resolved).toEqual([root]);
    });

    it('rejects paths that escape the workspace root', () => {
        const r = resolveIndexFolders('../outside', root);
        expect(r.resolved).toEqual([]);
        expect(r.errors.length).toBe(1);
        expect(r.errors[0]).toContain('../outside');
    });

    it('accepts an absolute path inside the workspace', () => {
        const inside = path.join(root, 'sub1');
        const r = resolveIndexFolders(inside, root);
        expect(r.resolved).toEqual([inside]);
        expect(r.errors).toEqual([]);
    });
});

describe('mergeAndSortResults', () => {
    it('flattens, sorts by score desc, and applies the limit', () => {
        const a: TaggedResult[] = [
            { relativePath: 'x', score: 0.4, searchFolder: '/f1', absolutePath: '/f1/x' } as TaggedResult,
        ];
        const b: TaggedResult[] = [
            { relativePath: 'y', score: 0.9, searchFolder: '/f2', absolutePath: '/f2/y' } as TaggedResult,
            { relativePath: 'z', score: 0.7, searchFolder: '/f2', absolutePath: '/f2/z' } as TaggedResult,
        ];
        const merged = mergeAndSortResults([a, b], 2);
        expect(merged.map(r => r.relativePath)).toEqual(['y', 'z']);
    });
});
