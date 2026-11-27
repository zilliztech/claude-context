/**
 * A single reranked document.
 */
export interface RerankResult {
    /** Index of the document in the list passed to `rerank`. */
    index: number;
    /** Relevance score assigned by the reranker. Higher is more relevant. */
    score: number;
}

/**
 * Abstract base class for reranker implementations.
 *
 * A reranker scores a list of candidate documents against a query, so search
 * results retrieved by vector similarity can be reordered by relevance.
 */
export abstract class Reranker {
    /**
     * Rerank documents against a query.
     * @param query Search query
     * @param documents Candidate documents
     * @param topK Maximum number of results to return (all documents when omitted)
     * @returns Results sorted from most to least relevant
     */
    abstract rerank(query: string, documents: string[], topK?: number): Promise<RerankResult[]>;

    /**
     * Get reranker provider name
     */
    abstract getProvider(): string;

    /**
     * Get reranker model name
     */
    abstract getModel(): string;
}
