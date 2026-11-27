import { parseExtraIgnoreFiles, selectIgnoreFiles } from './ignore-files';

describe('selectIgnoreFiles', () => {
    it('honors .gitignore and .contextignore', () => {
        const { selected } = selectIgnoreFiles(['.gitignore', '.contextignore', 'src', 'README.md']);

        expect(selected).toEqual(['.gitignore', '.contextignore']);
    });

    it('does not honor .dockerignore — a build filter is not a search filter', () => {
        const { selected, skipped } = selectIgnoreFiles(['.gitignore', '.dockerignore']);

        expect(selected).toEqual(['.gitignore']);
        expect(skipped).toEqual(['.dockerignore']);
    });

    it('reports every skipped .*ignore file so the reason is nameable', () => {
        const { skipped } = selectIgnoreFiles(['.dockerignore', '.npmignore', '.eslintignore', '.gitignore']);

        expect(skipped).toEqual(['.dockerignore', '.npmignore', '.eslintignore']);
    });

    it('lets an explicit opt-in re-enable a skipped file', () => {
        const { selected, skipped } = selectIgnoreFiles(['.gitignore', '.dockerignore'], ['.dockerignore']);

        expect(selected).toEqual(['.gitignore', '.dockerignore']);
        expect(skipped).toEqual([]);
    });

    it('ignores allowlisted names that are not present', () => {
        const { selected, skipped } = selectIgnoreFiles(['src']);

        expect(selected).toEqual([]);
        expect(skipped).toEqual([]);
    });
});

describe('parseExtraIgnoreFiles', () => {
    it('returns nothing when unset or empty', () => {
        expect(parseExtraIgnoreFiles(undefined)).toEqual([]);
        expect(parseExtraIgnoreFiles('')).toEqual([]);
        expect(parseExtraIgnoreFiles('  , ,')).toEqual([]);
    });

    it('trims entries and adds the leading dot', () => {
        expect(parseExtraIgnoreFiles('.dockerignore, npmignore')).toEqual(['.dockerignore', '.npmignore']);
    });
});
