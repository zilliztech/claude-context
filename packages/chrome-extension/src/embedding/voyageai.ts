import { EmbeddingProvider } from './types';

const DEFAULT_MODEL = 'voyage-code-3';

// Common voyage models; falls back to 1024 for unknown models.
const DIMENSION_BY_MODEL: Record<string, number> = {
    'voyage-code-3': 1024,
    'voyage-3-large': 1024,
    'voyage-3': 1024,
    'voyage-3-lite': 512,
    'voyage-code-2': 1536,
    'voyage-large-2': 1536,
    'voyage-2': 1024,
    'voyage-4-large': 1024,
    'voyage-4': 1024,
    'voyage-4-lite': 1024,
    'voyage-4-nano': 1024,
};

export class VoyageAIProvider implements EmbeddingProvider {
    readonly name = 'VoyageAI' as const;
    readonly dimension: number;
    private readonly apiKey: string;
    private readonly model: string;
    private readonly baseUrl: string;

    constructor(apiKey: string, model: string = DEFAULT_MODEL, baseUrl: string = 'https://api.voyageai.com/v1') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.dimension = DIMENSION_BY_MODEL[model] ?? 1024;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const isMongoCompat = this.baseUrl.includes('ai.mongodb.com');
        const body: Record<string, unknown> = {
            model: this.model,
            input: texts,
            input_type: 'document',
        };
        // MongoDB Atlas VoyageAI compat does not accept encoding_format.
        if (!isMongoCompat) body.encoding_format = 'float';

        const res = await fetch(`${this.baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`VoyageAI embeddings ${res.status}: ${text}`);
        }
        const json = await res.json();
        return json.data.map((d: { embedding: number[] }) => d.embedding);
    }

    async embedSingle(text: string): Promise<number[]> {
        const [v] = await this.embedBatch([text]);
        return v;
    }
}
