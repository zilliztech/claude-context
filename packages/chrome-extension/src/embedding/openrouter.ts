import { OpenAIProvider } from './openai';

/**
 * OpenRouter exposes an OpenAI-compatible /v1/embeddings endpoint, so we
 * piggy-back on the OpenAI client with a different base URL and api key.
 * Models are namespaced (e.g. "openai/text-embedding-3-small").
 */
export class OpenRouterProvider extends OpenAIProvider {
    readonly name = 'OpenRouter' as any; // narrow at usage sites via factory.

    constructor(apiKey: string, model: string = 'openai/text-embedding-3-small') {
        super(apiKey, model, 'https://openrouter.ai/api/v1');
    }
}
