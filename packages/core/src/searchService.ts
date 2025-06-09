import { SearchQuery, SearchResult, FileInfo, Symbol, Match } from './types';
import { CodeIndexer, SemanticSearchResult } from './indexer';

export class SearchService {
    private codeIndexer: CodeIndexer;

    constructor() {
        this.codeIndexer = new CodeIndexer();
    }

    /**
     * Execute semantic search
     */
    async search(query: SearchQuery): Promise<SearchResult[]> {
        const semanticResults = await this.codeIndexer.semanticSearch(
            query.term,
            query.limit || 50,
            0.3 // similarity threshold
        );

        // Convert to SearchResult format
        return semanticResults.map(result => this.convertToSearchResult(result));
    }

    /**
     * Index codebase
     */
    async indexCodebase(codebasePath: string): Promise<void> {
        await this.codeIndexer.indexCodebase(codebasePath);
    }

    /**
     * Get index statistics
     */
    getStats(): { indexedFiles: number; totalChunks: number } {
        return this.codeIndexer.getStats();
    }

    /**
     * Clear index
     */
    async clearIndex(): Promise<void> {
        await this.codeIndexer.clearIndex();
    }

    /**
     * Convert SemanticSearchResult to SearchResult
     */
    private convertToSearchResult(semanticResult: SemanticSearchResult): SearchResult {
        // Convert absolute path to relative path (if possible)
        let relativePath = semanticResult.filePath;
        if (process.cwd) {
            const cwd = process.cwd();
            // Ensure file path is truly within working directory, not just starts with same prefix
            if (semanticResult.filePath.startsWith(cwd + '/') || semanticResult.filePath.startsWith(cwd + '\\')) {
                relativePath = semanticResult.filePath.substring(cwd.length + 1);
            }
        }

        const file: FileInfo = {
            path: relativePath
        };

        // Create match information
        const matches: Match[] = [{
            line: semanticResult.startLine,
            column: 1,
            context: this.truncateContent(semanticResult.content, 150)
        }];

        // Try to infer symbol information from content
        const symbol = this.extractSymbolFromContent(semanticResult.content, semanticResult.startLine);

        return {
            file,
            symbol,
            matches
        };
    }

    /**
     * Extract symbol information from content
     */
    private extractSymbolFromContent(content: string, startLine: number): Symbol | undefined {
        const lines = content.split('\n');
        if (lines.length === 0) return undefined;

        const firstLine = lines[0].trim();

        // Try to match different symbol patterns
        const patterns = [
            { regex: /^export\s+class\s+(\w+)/, type: 'class' as const },
            { regex: /^class\s+(\w+)/, type: 'class' as const },
            { regex: /^export\s+interface\s+(\w+)/, type: 'interface' as const },
            { regex: /^interface\s+(\w+)/, type: 'interface' as const },
            { regex: /^export\s+function\s+(\w+)/, type: 'function' as const },
            { regex: /^function\s+(\w+)/, type: 'function' as const },
            { regex: /^export\s+const\s+(\w+)/, type: 'variable' as const },
            { regex: /^const\s+(\w+)/, type: 'variable' as const },
            { regex: /^export\s+let\s+(\w+)/, type: 'variable' as const },
            { regex: /^let\s+(\w+)/, type: 'variable' as const },
            { regex: /^\s*(\w+)\s*\([^)]*\)\s*[{:]/, type: 'method' as const },
        ];

        for (const pattern of patterns) {
            const match = firstLine.match(pattern.regex);
            if (match) {
                return {
                    name: match[1],
                    type: pattern.type,
                    location: { line: startLine, column: 1 },
                    signature: firstLine
                };
            }
        }

        return undefined;
    }

    /**
     * Truncate content to specified length
     */
    private truncateContent(content: string, maxLength: number): string {
        if (content.length <= maxLength) {
            return content;
        }
        return content.substring(0, maxLength) + '...';
    }

    /**
     * Generate quick pick items
     */
    generateQuickPickItems(results: SearchResult[], searchTerm: string) {
        return results.slice(0, 20).map(result => ({
            label: result.symbol ?
                `$(symbol-${result.symbol.type}) ${result.symbol.name}` :
                `$(file-code) ${result.file.path}`,
            description: result.symbol ?
                `${result.symbol.type} in ${result.file.path}:${result.symbol.location.line}` :
                `${result.matches.length} matches in ${result.file.path}`,
            detail: result.symbol?.signature ||
                (result.matches[0] ? result.matches[0].context : ''),
            result: result
        }));
    }
} 