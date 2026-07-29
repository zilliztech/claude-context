import { DEFAULT_IGNORE_PATTERNS } from './context';

describe('DEFAULT_IGNORE_PATTERNS', () => {
    it('ignores Python virtualenv folders', () => {
        expect(DEFAULT_IGNORE_PATTERNS).toContain('venv/**');
        expect(DEFAULT_IGNORE_PATTERNS).toContain('.venv/**');
        expect(DEFAULT_IGNORE_PATTERNS).toContain('venv');
        expect(DEFAULT_IGNORE_PATTERNS).toContain('.venv');
    });

    it('still ignores node_modules', () => {
        expect(DEFAULT_IGNORE_PATTERNS).toContain('node_modules');
    });
});
