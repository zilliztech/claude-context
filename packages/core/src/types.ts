export interface SearchQuery {
    term: string;
    includeContent?: boolean;
    limit?: number;
}

export interface SemanticSearchResult {
    content: string;
    filePath: string;
    startLine: number;
    endLine: number;
    language: string;
    score: number;
}
