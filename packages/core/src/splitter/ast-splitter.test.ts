import { AstCodeSplitter } from './ast-splitter';
import type { CodeChunk } from './index';

function expectSourceCoverage(code: string, chunks: CodeChunk[], size: number, overlap = 0): void {
    let covered = 0;
    for (const chunk of chunks) {
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.content.length).toBeLessThanOrEqual(size);
        const earliestStart = Math.max(0, covered - overlap, covered - chunk.content.length + 1);
        const start = code.indexOf(chunk.content, earliestStart);
        expect(start).toBeGreaterThanOrEqual(earliestStart);
        expect(start).toBeLessThanOrEqual(covered);
        const end = start + chunk.content.length;
        expect(end).toBeGreaterThan(covered);
        expect(chunk.metadata.startLine).toBe(code.slice(0, start).split('\n').length);
        expect(chunk.metadata.endLine).toBe(code.slice(0, end - 1).split('\n').length);
        covered = end;
    }
    expect(covered).toBe(code.length);
    if (overlap === 0) expect(chunks.map(chunk => chunk.content).join('')).toBe(code);
}

describe('AstCodeSplitter source coverage', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => jest.restoreAllMocks());

    const sources = [
        ['javascript', `// Response configuration\nconst DEFAULT_LIMIT = 17;\nres.json = function json(obj) { return JSON.stringify(obj); };\nfunction helper(value) { return String(value); }\nstart();\n`],
        ['typescript', `// Handler configuration\nconst DEFAULT_LIMIT: number = 17;\nconst handler = function handler(): number { return DEFAULT_LIMIT; };\nfunction helper(): number { return 1; }\nhandler();\n`],
        ['python', `# Request configuration\nimport os\nDEFAULT_TIMEOUT = 17\n\ndef timeout():\n    return DEFAULT_TIMEOUT\n\nprint(timeout())\n`],
        ['go', `// Application entry point\npackage example\nimport "fmt"\nconst defaultLimit = 17\nfunc run() { fmt.Println(defaultLimit) }\n`],
        ['rust', `// Retry configuration\nuse std::time::Duration;\nconst RETRY_LIMIT: u32 = 17;\nfn limit() -> u32 { RETRY_LIMIT }\n`],
        ['cpp', `// Retry configuration\n#include <vector>\n#define RETRY_LIMIT 17\nint limit() { return RETRY_LIMIT; }\n`],
        ['java', `package example;\nimport java.time.Duration;\nclass Example { static final int RETRY_LIMIT = 17; int limit() { return RETRY_LIMIT; } }\n`],
        ['csharp', `using System;\nnamespace Example { class App { public const int Limit = 17; public void Run() { Console.WriteLine(Limit); } } }\n`],
        ['scala', `import scala.util.Try\nobject Example { val retryLimit = 17; def limit(): Int = retryLimit; println(limit()) }\n`],
    ];

    it.each(sources)('preserves every source interval when splitting %s', async (language, code) => {
        const chunks = await new AstCodeSplitter(80, 0).split(code, language, 'example');
        expect(chunks.length).toBeGreaterThan(1);
        expectSourceCoverage(code, chunks, 80);
        for (const chunk of chunks) {
            expect(chunk.metadata).toMatchObject({ language, filePath: 'example' });
        }
    });

    it('packs adjacent small functions and definitions into one chunk', async () => {
        const code = 'function a() { return 1; }\nconst limit = 17;\nfunction b() { return limit; }\n';
        const chunks = await new AstCodeSplitter(2500, 0).split(code, 'javascript');
        expect(chunks).toHaveLength(1);
        expectSourceCoverage(code, chunks, 2500);
    });

    it('merges short definitions with the preceding function when they fit', async () => {
        const a = `function a() { return '${'a'.repeat(100)}'; }`;
        const definitions = '\nconst limit = 17;';
        const b = `\nfunction b() { return '${'b'.repeat(100)}'; }`;
        const code = a + definitions + b;
        const chunks = await new AstCodeSplitter(180, 0).split(code, 'javascript');
        expect(chunks.map(c => c.content)).toEqual([a + definitions, b]);
        expectSourceCoverage(code, chunks, 180);
    });

    it('merges short definitions with the next function when the preceding chunk is full', async () => {
        const a = `function a() { return '${'a'.repeat(140)}'; }`;
        const definitions = '\nconst limit = 17;';
        const b = '\nfunction b() { return limit; }';
        const code = a + definitions + b;
        const chunks = await new AstCodeSplitter(180, 0).split(code, 'javascript');
        expect(chunks.map(c => c.content)).toEqual([a, definitions + b]);
        expectSourceCoverage(code, chunks, 180);
    });

    it('splits large functions without losing or duplicating nested code', async () => {
        const body = Array.from({ length: 120 }, (_, i) => `    total += ${i};`).join('\n');
        const code = `// Header\nclass Counter {\n  a() {\n${body}\n  }\n  b() {\n${body}\n  }\n}\nrun();\n`;
        const chunks = await new AstCodeSplitter(700, 0).split(code, 'javascript');
        expect(chunks.length).toBeGreaterThan(2);
        expectSourceCoverage(code, chunks, 700);
    });

    it('bounds long leaf nodes and single lines', async () => {
        const code = `const payload = "${'x'.repeat(6000)}";\nfunction read() { return payload; }\n`;
        const chunks = await new AstCodeSplitter(2500, 300).split(code, 'javascript');
        expectSourceCoverage(code, chunks, 2500, 300);
    });

    it('handles deeply nested generated code without exhausting the call stack', async () => {
        const code = `const value = ${'('.repeat(10000)}42${')'.repeat(10000)};`;
        const chunks = await new AstCodeSplitter(100, 0).split(code, 'javascript');
        expectSourceCoverage(code, chunks, 100);
    });

    it('adds overlap from contiguous source within the final size budget', async () => {
        const code = Array.from({ length: 6 }, (_, i) => `function f${i}() { return '${String(i).repeat(55)}'; }\n`).join('');
        const chunks = await new AstCodeSplitter(200, 25).split(code, 'javascript');
        expectSourceCoverage(code, chunks, 200, 25);
        expect(chunks.reduce((sum, c) => sum + c.content.length, 0)).toBeGreaterThan(code.length);
    });

    it('keeps functions that fit intact even when overlap must shrink', async () => {
        const a = `function a() { return '${'a'.repeat(140)}'; }`;
        const b = `\nfunction b() { return '${'b'.repeat(140)}'; }`;
        const chunks = await new AstCodeSplitter(180, 100).split(a + b, 'javascript');
        expect(chunks).toHaveLength(2);
        expect(chunks[0].content).toContain(a);
        expect(chunks[1].content).toContain(b);
        expectSourceCoverage(a + b, chunks, 180, 100);
    });

    it('preserves Unicode, CRLF, leading whitespace and trailing comments with accurate lines', async () => {
        const comments = Array.from({ length: 12 }, (_, i) => `// 注释 ${i} 😀\r\n`).join('');
        const code = `\r\n// 中文 😀\r\nconst message = "你好 🌍";\r\nfunction read() { return message; }\r\n${comments}  `;
        const chunks = await new AstCodeSplitter(70, 15).split(code, 'javascript');
        expectSourceCoverage(code, chunks, 70, 15);
        for (const chunk of chunks) {
            expect(chunk.content).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
        }
    });

    it('preserves incomplete source while still enforcing the size bound', async () => {
        const code = `const settings = ${' '.repeat(20)}\nfunction unfinished( {\n${'  value += 1;\n'.repeat(30)}`;
        const chunks = await new AstCodeSplitter(120, 0).split(code, 'javascript');
        expectSourceCoverage(code, chunks, 120);
    });

    it('uses bounded text ranges for unsupported languages and parser failures', async () => {
        const payload = Array.from({ length: 100 }, (_, i) => `${i}:αβ😀|`).join('');
        const code = `  heading\n\n${payload}\n  trailing text\n`;
        const splitter = new AstCodeSplitter(75, 15);
        const unsupported = await splitter.split(code, 'unknown');
        expectSourceCoverage(code, unsupported, 75, 15);

        const parser = (splitter as any).parser;
        jest.spyOn(parser, 'parse').mockImplementation(() => { throw new Error('Parser unavailable'); });
        const failed = await splitter.split(code, 'javascript');
        expectSourceCoverage(code, failed, 75, 15);
    });

    it('honors size and zero-overlap setters', async () => {
        const splitter = new AstCodeSplitter();
        splitter.setChunkSize(80);
        splitter.setChunkOverlap(0);
        const code = sources[0][1];
        expectSourceCoverage(code, await splitter.split(code, 'javascript'), 80);
    });

    it('handles empty and whitespace-only input', async () => {
        const splitter = new AstCodeSplitter(10, 0);
        expect(await splitter.split('', 'javascript')).toEqual([]);
        const code = ' \n\t\n';
        expectSourceCoverage(code, await splitter.split(code, 'javascript'), 10);
    });

    it('rejects sizes that cannot make forward progress', () => {
        for (const size of [0, -1, 0.5, NaN, Infinity]) {
            expect(() => new AstCodeSplitter(size)).toThrow(RangeError);
        }
        expect(() => new AstCodeSplitter().setChunkSize(0)).toThrow(RangeError);
        expect(() => new AstCodeSplitter(80, -1)).toThrow(RangeError);
    });
});
