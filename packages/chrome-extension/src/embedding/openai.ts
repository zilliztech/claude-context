import { EmbeddingProvider } from './types';

const DEFAULT_MODEL = 'text-embedding-3-small';
const DIMENSION_BY_MODEL: Record<string, number> = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
};

export class OpenAIProvider implements EmbeddingProvider {
    readonly name = 'OpenAI' as const;
    readonly dimension: number;
    private readonly model: string;
    private readonly apiKey: string;
    private readonly baseUrl: string;

    constructor(apiKey: string, model: string = DEFAULT_MODEL, baseUrl: string = 'https://api.openai.com/v1') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.dimension = DIMENSION_BY_MODEL[model] ?? 1536;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const res = await fetch(`${this.baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ model: this.model, input: texts }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`OpenAI embeddings ${res.status}: ${text}`);
        }
        const json = await res.json();
        return json.data.map((d: { embedding: number[] }) => d.embedding);
    }

    async embedSingle(text: string): Promise<number[]> {
        const [v] = await this.embedBatch([text]);
        return v;
    }
}
