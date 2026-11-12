import Parser from 'tree-sitter';
import type { Splitter, CodeChunk } from './index';

const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const Python = require('tree-sitter-python');
const Java = require('tree-sitter-java');
const Cpp = require('tree-sitter-cpp');
const Go = require('tree-sitter-go');
const Rust = require('tree-sitter-rust');
const CSharp = require('tree-sitter-c-sharp');
const Scala = require('tree-sitter-scala');

const LANGUAGE_PARSERS: Record<string, any> = {
    javascript: JavaScript, js: JavaScript,
    typescript: TypeScript, ts: TypeScript,
    python: Python, py: Python,
    java: Java,
    cpp: Cpp, 'c++': Cpp, c: Cpp,
    go: Go,
    rust: Rust, rs: Rust,
    csharp: CSharp, cs: CSharp,
    scala: Scala,
};

interface SourceRange {
    start: number;
    end: number;
}

export class AstCodeSplitter implements Splitter {
    private chunkSize = 2500;
    private chunkOverlap = 300;
    private parser: Parser;

    constructor(chunkSize = 2500, chunkOverlap = 300) {
        this.setChunkSize(chunkSize);
        this.setChunkOverlap(chunkOverlap);
        this.parser = new Parser();
    }

    async split(code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        if (code.length === 0) return [];

        let root: Parser.SyntaxNode | undefined;
        if (AstCodeSplitter.isLanguageSupported(language)) {
            try {
                this.parser.setLanguage(LANGUAGE_PARSERS[language.toLowerCase()]);
                const tree = this.parser.parse(code);
                if (!tree.rootNode.hasError) root = tree.rootNode;
            } catch (error) {
                console.warn('[ASTSplitter] Using text boundaries for ' + (filePath || language) + ': ' + error);
            }
        }

        // Ranges partition the entire source. Pack adjacent ranges without
        // emitting a parent node again alongside its children.
        const ranges: SourceRange[] = [];
        for (const range of this.splitRange(code, 0, code.length, root)) {
            const previous = ranges[ranges.length - 1];
            if (previous && range.end - previous.start <= this.chunkSize) {
                previous.end = range.end;
            } else {
                ranges.push({ ...range });
            }
        }

        const lineStarts = [0];
        for (let i = 0; i < code.length; i++) {
            if (code[i] === '\n') lineStarts.push(i + 1);
        }

        return ranges.map(range => {
            // Overlap is an optional prefix of the original source and must
            // fit within the final size limit, even for nearly full functions.
            const overlap = Math.min(this.chunkOverlap, this.chunkSize - (range.end - range.start));
            let start = Math.max(0, range.start - overlap);
            if (start < range.start && this.isSurrogateBoundary(code, start)) start++;
            return {
                content: code.slice(start, range.end),
                metadata: {
                    startLine: this.lineAt(lineStarts, start),
                    endLine: this.lineAt(lineStarts, range.end - 1),
                    language,
                    filePath,
                },
            };
        });
    }

    setChunkSize(chunkSize: number): void {
        if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
            throw new RangeError('chunkSize must be a positive integer');
        }
        this.chunkSize = chunkSize;
    }

    setChunkOverlap(chunkOverlap: number): void {
        if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0) {
            throw new RangeError('chunkOverlap must be a non-negative integer');
        }
        this.chunkOverlap = chunkOverlap;
    }

    private *splitRange(code: string, start: number, end: number, node?: Parser.SyntaxNode): Generator<SourceRange> {
        // An explicit stack also handles deeply nested generated source.
        const pending: Array<SourceRange & { node?: Parser.SyntaxNode }> = [{ start, end, node }];
        while (pending.length > 0) {
            const current = pending.pop()!;
            if (current.start === current.end) continue;
            if (current.end - current.start <= this.chunkSize) {
                yield { start: current.start, end: current.end };
                continue;
            }

            const children = current.node?.namedChildren || [];
            if (children.length === 0) {
                yield* this.splitTextRange(code, current.start, current.end);
                continue;
            }

            pending.push({ start: children[children.length - 1].endIndex, end: current.end });
            for (let i = children.length - 1; i >= 0; i--) {
                // Starting at the previous end retains all text between nodes.
                // Push in reverse order so ranges are consumed in source order.
                pending.push({
                    start: i === 0 ? current.start : children[i - 1].endIndex,
                    end: children[i].endIndex,
                    node: children[i],
                });
            }
        }
    }

    private *splitTextRange(code: string, start: number, end: number): Generator<SourceRange> {
        while (start < end) {
            let next = Math.min(start + this.chunkSize, end);
            if (next < end) {
                const newline = code.lastIndexOf('\n', next - 1);
                if (newline >= start) next = newline + 1;
                // Keep surrogate pairs together whenever the size allows it.
                if (next - start > 1 && this.isSurrogateBoundary(code, next)) next--;
            }
            yield { start, end: next };
            start = next;
        }
    }

    private isSurrogateBoundary(code: string, offset: number): boolean {
        const previous = code.charCodeAt(offset - 1);
        const current = code.charCodeAt(offset);
        return previous >= 0xD800 && previous <= 0xDBFF && current >= 0xDC00 && current <= 0xDFFF;
    }

    private lineAt(lineStarts: number[], offset: number): number {
        let low = 0;
        let high = lineStarts.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (lineStarts[middle] <= offset) low = middle + 1;
            else high = middle;
        }
        return low;
    }

    static isLanguageSupported(language: string): boolean {
        return Object.prototype.hasOwnProperty.call(LANGUAGE_PARSERS, language.toLowerCase());
    }
}
