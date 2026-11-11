import { AstCodeSplitter } from './ast-splitter';

// Simulate a broken grammar package (e.g. an unsigned native prebuild on
// macOS arm64). Any require of 'tree-sitter-cpp' throws ERR_DLOPEN_FAILED,
// exactly like the real failure reported in the issue.
// Counter tracks how many times the loader is actually invoked; the
// `mock`-prefix keeps it referenceable from the hoisted module factory.
let mockCppRequireCount = 0;
jest.mock('tree-sitter-cpp', () => {
    mockCppRequireCount++;
    throw new Error('dlopen(.../tree-sitter-cpp.node): code signature invalid');
});

describe('AstCodeSplitter lazy grammar loading', () => {
    it('loads the module and constructs a splitter even when a grammar is broken', () => {
        const splitter = new AstCodeSplitter();
        expect(splitter).toBeInstanceOf(AstCodeSplitter);
    });

    it('falls back to the LangChain splitter for a language whose grammar failed to load', async () => {
        const splitter = new AstCodeSplitter(2500, 300);
        const chunks = await splitter.split('int main() {\n  return 0;\n}', 'cpp', 'broken.cpp');
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[0].content).toContain('int main');
    });

    it('still uses AST splitting for a language whose grammar loads', async () => {
        const splitter = new AstCodeSplitter(2500, 300);
        const code = 'function foo() {\n  return 1;\n}\n\nfunction bar() {\n  return 2;\n}';
        const chunks = await splitter.split(code, 'javascript', 'working.js');
        // AST splitting produces one chunk per function declaration.
        expect(chunks.length).toBe(2);
        expect(chunks.map((c) => c.content).join('\n')).toContain('function foo');
        expect(chunks.map((c) => c.content).join('\n')).toContain('function bar');
    });

    it('reports a language whose grammar failed to load as unsupported', () => {
        expect(AstCodeSplitter.isLanguageSupported('cpp')).toBe(false);
        expect(AstCodeSplitter.isLanguageSupported('javascript')).toBe(true);
    });

    it('memoizes failed grammar loads: require and warning run only once', async () => {
        // Earlier tests share the module instance and already mark cpp failed;
        // reload a fresh module so this test owns the full lifecycle.
        jest.resetModules();
        mockCppRequireCount = 0;
        const { AstCodeSplitter: FreshSplitter } = await import('./ast-splitter');
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const splitter = new FreshSplitter(2500, 300);

        // First attempt: loader throws, language marked failed, warning logged.
        const first = await splitter.split('int a = 1;', 'cpp', 'a.cpp');
        expect(first.length).toBeGreaterThan(0); // LangChain fallback works
        expect(mockCppRequireCount).toBe(1); // exactly one load attempt
        const warnsAfterFirst = warnSpy.mock.calls.length;

        // Second attempt: failedLanguages short-circuits — no reload, no new warning.
        const second = await splitter.split('int b = 2;', 'cpp', 'b.cpp');
        expect(second.length).toBeGreaterThan(0);
        expect(mockCppRequireCount).toBe(1); // loader NOT re-invoked
        expect(warnSpy.mock.calls.length).toBe(warnsAfterFirst); // warning NOT repeated

        warnSpy.mockRestore();
    });
});
