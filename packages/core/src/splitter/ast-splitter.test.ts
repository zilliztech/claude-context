import { AstCodeSplitter, SPLITTABLE_NODE_TYPES } from './ast-splitter';

const DART_SAMPLE = `
// A simple Dart class
class Person {
  String name;
  int age;

  Person(this.name, this.age);

  void greet() {
    print('Hello, my name is $name');
  }
}

// A Dart mixin
mixin Flyable {
  void fly() {
    print('Flying!');
  }
}

// A Dart extension
extension StringExtension on String {
  String get reversed => split('').reversed.join();
}

// Top-level function
int add(int a, int b) {
  return a + b;
}
`;

describe('AstCodeSplitter Dart support', () => {
    describe('isLanguageSupported', () => {
        it('returns a boolean (true if binding available, false otherwise)', () => {
            const result = AstCodeSplitter.isLanguageSupported('dart');
            expect(typeof result).toBe('boolean');
        });

        it('is case-insensitive', () => {
            const upper = AstCodeSplitter.isLanguageSupported('DART');
            const lower = AstCodeSplitter.isLanguageSupported('dart');
            expect(upper).toBe(lower);
        });

        it('returns true for other supported languages regardless of dart binding', () => {
            expect(AstCodeSplitter.isLanguageSupported('javascript')).toBe(true);
            expect(AstCodeSplitter.isLanguageSupported('typescript')).toBe(true);
            expect(AstCodeSplitter.isLanguageSupported('python')).toBe(true);
            expect(AstCodeSplitter.isLanguageSupported('scala')).toBe(true);
        });

        it('returns false for unsupported languages', () => {
            expect(AstCodeSplitter.isLanguageSupported('cobol')).toBe(false);
            expect(AstCodeSplitter.isLanguageSupported('fortran')).toBe(false);
        });
    });

    describe('split with Dart code', () => {
        it('produces non-empty chunks from valid Dart code', async () => {
            const splitter = new AstCodeSplitter(1000, 200);
            const chunks = await splitter.split(DART_SAMPLE, 'dart', 'sample.dart');

            expect(chunks.length).toBeGreaterThan(0);
            chunks.forEach(chunk => {
                expect(chunk.content.trim().length).toBeGreaterThan(0);
                expect(chunk.metadata.language).toBe('dart');
                expect(chunk.metadata.filePath).toBe('sample.dart');
                expect(chunk.metadata.startLine).toBeGreaterThan(0);
                expect(chunk.metadata.endLine).toBeGreaterThanOrEqual(chunk.metadata.startLine);
            });
        });

        it('includes class, mixin, extension, and function chunks', async () => {
            const splitter = new AstCodeSplitter(1000, 200);
            const chunks = await splitter.split(DART_SAMPLE, 'dart', 'sample.dart');
            const allContent = chunks.map(c => c.content).join(' ');

            expect(allContent).toContain('class');
            expect(allContent).toContain('mixin');
            expect(allContent).toContain('extension');
            expect(allContent).toContain('int add');
        });

        it('does not crash when dart binding is unavailable (graceful fallback)', async () => {
            const splitter = new AstCodeSplitter(500, 100);
            await expect(splitter.split(DART_SAMPLE, 'dart', 'sample.dart')).resolves.toBeDefined();
        });

        it('sets correct startLine and endLine metadata on chunks', async () => {
            const splitter = new AstCodeSplitter(1000, 200);
            const chunks = await splitter.split(DART_SAMPLE, 'dart', 'sample.dart');

            for (const chunk of chunks) {
                expect(chunk.metadata.startLine).toBeLessThanOrEqual(chunk.metadata.endLine);
                expect(chunk.metadata.startLine).toBeGreaterThanOrEqual(1);
                expect(chunk.metadata.endLine).toBeLessThanOrEqual(35);
            }
        });

        it('handles empty Dart code without throwing', async () => {
            const splitter = new AstCodeSplitter(1000, 200);
            const chunks = await splitter.split('', 'dart', 'empty.dart');
            expect(Array.isArray(chunks)).toBe(true);
        });
    });

    describe('SPLITTABLE_NODE_TYPES — Dart AST node type names', () => {
        it('declares the correct 6 Dart node types matching tree-sitter-dart grammar', () => {
            const dartTypes: string[] = SPLITTABLE_NODE_TYPES.dart;
            expect(dartTypes).toContain('class_definition');
            expect(dartTypes).toContain('mixin_declaration');
            expect(dartTypes).toContain('extension_declaration');
            expect(dartTypes).toContain('local_function_declaration');
            expect(dartTypes).toContain('method_signature');
            expect(dartTypes).toContain('constructor_signature');
            expect(dartTypes).toHaveLength(6);
        });
    });
});

describe('Lazy-loading — no side effects for non-Dart languages', () => {
    it('splitting Python does not trigger a tree-sitter-dart warning', async () => {
        const splitter = new AstCodeSplitter(1000, 200);
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        await splitter.split('def foo(): pass', 'python', 'sample.py');

        const dartWarnings = warnSpy.mock.calls.filter(args =>
            args.some(arg => String(arg).includes('tree-sitter-dart'))
        );
        expect(dartWarnings.length).toBe(0);
        warnSpy.mockRestore();
    });

    it('warns about tree-sitter-dart only when dart split is attempted', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        warnSpy.mockClear();

        // Module import should not emit a dart warning
        // Splitting Python should not emit a dart warning
        const splitter = new AstCodeSplitter(1000, 200);
        await splitter.split('def foo(): pass', 'python', 'sample.py');
        expect(warnSpy.mock.calls.filter(args =>
            args.some(arg => String(arg).includes('tree-sitter-dart'))
        ).length).toBe(0);

        // Now split Dart — warning should appear (binding unavailable)
        await splitter.split(DART_SAMPLE, 'dart', 'sample.dart');
        const dartWarnings = warnSpy.mock.calls.filter(args =>
            args.some(arg => String(arg).includes('tree-sitter-dart'))
        );
        expect(dartWarnings.length).toBe(1);

        warnSpy.mockRestore();
    });
});
