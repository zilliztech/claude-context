import { AstCodeSplitter } from './ast-splitter';
import { CodeChunk } from './index';

const split = async (lines: string[], language: string): Promise<CodeChunk[]> => {
    const splitter = new AstCodeSplitter();
    // Disable overlap so each chunk holds exactly the source range it covers.
    splitter.setChunkOverlap(0);
    return splitter.split(lines.join('\n'), language, `example.${language}`);
};

const findChunk = (chunks: CodeChunk[], declaration: string): CodeChunk => {
    const chunk = chunks.find((candidate) => candidate.content.endsWith(declaration));
    if (!chunk) {
        throw new Error(`No chunk ends with ${JSON.stringify(declaration)}`);
    }
    return chunk;
};

describe('AstCodeSplitter leading comments', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('keeps a JSDoc block in the same chunk as the function it documents', async () => {
        const chunks = await split([
            "import { join } from 'path';",
            '',
            '/**',
            ' * Adds two numbers.',
            ' */',
            'function add(a, b) {',
            '    return a + b;',
            '}',
        ], 'javascript');

        expect(chunks).toHaveLength(1);
        expect(chunks[0].content).toBe([
            '/**',
            ' * Adds two numbers.',
            ' */',
            'function add(a, b) {',
            '    return a + b;',
            '}',
        ].join('\n'));
        expect(chunks[0].metadata).toMatchObject({ startLine: 3, endLine: 8 });
    });

    it('leaves out comments separated by a blank line and trailing comments of previous statements', async () => {
        const chunks = await split([
            '// Copyright header',
            '',
            'function first() {}',
            'run(); // trailing note',
            'function second() {}',
        ], 'javascript');

        expect(chunks.map((chunk) => chunk.content)).toEqual([
            'function first() {}',
            'function second() {}',
        ]);
        expect(findChunk(chunks, 'function first() {}').metadata.startLine).toBe(3);
        expect(findChunk(chunks, 'function second() {}').metadata.startLine).toBe(5);
    });

    it('attaches comments to class members, including across TypeScript decorators', async () => {
        const chunks = await split([
            'class Controller {',
            '    /** Lists users. */',
            '    @Get()',
            '    list() {}',
            '}',
        ], 'typescript');

        const method = findChunk(chunks, 'list() {}');
        expect(method.content).toBe([
            '/** Lists users. */',
            '    @Get()',
            '    list() {}',
        ].join('\n'));
        expect(method.metadata).toMatchObject({ startLine: 2, endLine: 4 });
    });

    it('attaches Python comments, including those before the first statement of a block', async () => {
        const chunks = await split([
            '# Loads the config.',
            'def load():',
            '    pass',
            '',
            'class Service:',
            '    # Starts the service.',
            '    @staticmethod',
            '    def start():',
            '        pass',
        ], 'python');

        const load = findChunk(chunks, 'def load():\n    pass');
        expect(load.content).toBe('# Loads the config.\ndef load():\n    pass');
        expect(load.metadata).toMatchObject({ startLine: 1, endLine: 3 });

        const start = chunks.find((chunk) => chunk.content.startsWith('# Starts the service.'));
        expect(start?.content).toBe([
            '# Starts the service.',
            '    @staticmethod',
            '    def start():',
            '        pass',
        ].join('\n'));
        expect(start?.metadata).toMatchObject({ startLine: 6, endLine: 9 });
    });

    it('does not emit a nested declaration twice once it covers the same range as its parent', async () => {
        const chunks = await split([
            '@cache',
            'def cached():',
            '    pass',
        ], 'python');

        expect(chunks.map((chunk) => chunk.content)).toEqual([
            '@cache\ndef cached():\n    pass',
        ]);
    });

    it('keeps multi-line Go doc comments with the function', async () => {
        const chunks = await split([
            'package main',
            '',
            '// Serve starts',
            '// the server.',
            'func Serve() {}',
        ], 'go');

        const serve = findChunk(chunks, 'func Serve() {}');
        expect(serve.content).toBe('// Serve starts\n// the server.\nfunc Serve() {}');
        expect(serve.metadata).toMatchObject({ startLine: 3, endLine: 5 });
    });

    it('keeps Rust doc comments and attributes with the item without crossing blank lines', async () => {
        const chunks = await split([
            '// Detached comment.',
            '',
            '/// A point.',
            '#[derive(Debug)]',
            'struct Point {}',
        ], 'rust');

        const point = findChunk(chunks, 'struct Point {}');
        expect(point.content).toBe('/// A point.\n#[derive(Debug)]\nstruct Point {}');
        expect(point.metadata).toMatchObject({ startLine: 3, endLine: 5 });
    });

    it('keeps Javadoc with annotated Java methods', async () => {
        const chunks = await split([
            'class Users {',
            '    /**',
            '     * Finds a user.',
            '     */',
            '    @Override',
            '    public User find() {',
            '        return null;',
            '    }',
            '}',
        ], 'java');

        const find = chunks.find((chunk) => chunk.content.startsWith('/**'));
        expect(find?.content).toBe([
            '/**',
            '     * Finds a user.',
            '     */',
            '    @Override',
            '    public User find() {',
            '        return null;',
            '    }',
        ].join('\n'));
        expect(find?.metadata).toMatchObject({ startLine: 2, endLine: 8 });
    });

    it('slices comments correctly when the source contains non-ASCII characters', async () => {
        const chunks = await split([
            "const label = '🚀 naïve';",
            '// Résumé helper 🚀',
            'function resume() {}',
        ], 'javascript');

        expect(findChunk(chunks, 'function resume() {}').content).toBe('// Résumé helper 🚀\nfunction resume() {}');
    });
});
