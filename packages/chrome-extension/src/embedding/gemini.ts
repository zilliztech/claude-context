import { EmbeddingProvider } from './types';

const DEFAULT_MODEL = 'gemini-embedding-001';

export class GeminiProvider implements EmbeddingProvider {
    readonly name = 'Gemini' as const;
    readonly dimension: number;
    private readonly apiKey: string;
    private readonly model: string;
    private readonly baseUrl: string;

    constructor(apiKey: string, model: string = DEFAULT_MODEL, baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.replace(/\/$/, '');
        // gemini-embedding-001 returns 3072-dim by default; can be lowered via outputDimensionality.
        this.dimension = 3072;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        // Gemini batch endpoint: batchEmbedContents
        const res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(this.model)}:batchEmbedContents?key=${this.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: texts.map((text) => ({
                    model: `models/${this.model}`,
                    content: { parts: [{ text }] },
                })),
            }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Gemini embeddings ${res.status}: ${text}`);
        }
        const json = await res.json();
        return json.embeddings.map((e: { values: number[] }) => e.values);
    }

    async embedSingle(text: string): Promise<number[]> {
        const [v] = await this.embedBatch([text]);
        return v;
    }
}
