export class VectorSearchResultValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'VectorSearchResultValidationError';
    }
}

export function isVectorSearchResultValidationError(error: unknown): error is VectorSearchResultValidationError {
    return error instanceof VectorSearchResultValidationError ||
        (error instanceof Error && error.name === 'VectorSearchResultValidationError');
}

export function validateMilvusSearchResultRow(row: unknown, collectionName: string, index: number, scoreFields: string[] = ['score']): any {
    const diagnostic = `Malformed Milvus search result for collection '${collectionName}' at result index ${index}. ` +
        `This can be caused by an embedding dimension mismatch, collection mismatch, or schema/configuration mismatch. ` +
        `Check that indexing and search use the same embedding provider and collection configuration.`;

    if (row === null || row === undefined || typeof row !== 'object') {
        throw new VectorSearchResultValidationError(`${diagnostic} Expected a result object but received ${row === null ? 'null' : typeof row}.`);
    }

    const result = row as Record<string, unknown>;
    const scoreField = scoreFields.find((field) => typeof result[field] === 'number' && Number.isFinite(result[field]));
    if (!scoreField) {
        throw new VectorSearchResultValidationError(`${diagnostic} Missing numeric score field; expected one of: ${scoreFields.join(', ')}.`);
    }

    return result;
}
