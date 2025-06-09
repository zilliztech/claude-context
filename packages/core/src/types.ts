export interface SearchQuery {
    term: string;
    includeContent?: boolean;
    limit?: number;
}

export interface FileLocation {
    line: number;
    column: number;
}

export interface Symbol {
    name: string;
    type: 'class' | 'interface' | 'function' | 'variable' | 'method' | 'property';
    location: FileLocation;
    signature: string;
}

export interface FileInfo {
    path: string;
}

export interface Match {
    line: number;
    column: number;
    context: string;
}

export interface SearchResult {
    file: FileInfo;
    symbol?: Symbol;
    matches: Match[];
}

export interface ICodeIndexer {
    search(query: SearchQuery): Promise<SearchResult[]>;
    indexDirectory(path: string): Promise<void>;
    getFileCount(): number;
    getSymbolCount(): number;
} 