import { EmbeddingProvider, EMBEDDING_STORAGE_KEYS, EmbeddingProviderName, EmbeddingStorageShape } from './types';
import { OpenAIProvider } from './openai';
import { VoyageAIProvider } from './voyageai';
import { GeminiProvider } from './gemini';
import { OpenRouterProvider } from './openrouter';

const STORAGE_KEYS = Object.values(EMBEDDING_STORAGE_KEYS);

/** Read the user's chosen embedding provider + creds and build a provider. */
export async function createEmbeddingProvider(): Promise<EmbeddingProvider> {
    const settings = await readSettings();
    const provider = settings.embeddingProvider || 'OpenAI';

    switch (provider) {
        case 'OpenAI': {
            const key = settings.openaiToken;
            if (!key) throw new Error('OpenAI API key is not configured.');
            return new OpenAIProvider(key, settings.embeddingModel);
        }
        case 'VoyageAI': {
            const key = settings.voyageaiToken;
            if (!key) throw new Error('VoyageAI API key is not configured.');
            return new VoyageAIProvider(key, settings.embeddingModel, settings.voyageaiBaseUrl);
        }
        case 'Gemini': {
            const key = settings.geminiToken;
            if (!key) throw new Error('Gemini API key is not configured.');
            return new GeminiProvider(key, settings.embeddingModel);
        }
        case 'OpenRouter': {
            const key = settings.openrouterToken;
            if (!key) throw new Error('OpenRouter API key is not configured.');
            return new OpenRouterProvider(key, settings.embeddingModel);
        }
        default:
            throw new Error(`Unknown embedding provider: ${provider}`);
    }
}

export async function getConfiguredProviderName(): Promise<EmbeddingProviderName> {
    const settings = await readSettings();
    return settings.embeddingProvider || 'OpenAI';
}

function readSettings(): Promise<EmbeddingStorageShape> {
    return new Promise((resolve) => {
        chrome.storage.sync.get(STORAGE_KEYS, (items: EmbeddingStorageShape) => {
            resolve(items);
        });
    });
}
