/**
 * Factory that builds the right vector DB adapter based on the user's setting.
 * Reads `vectordbProvider` from chrome.storage.sync, defaults to `milvus` for
 * backward compatibility.
 */

import { ChromeMilvusAdapter } from '../milvus/chromeMilvusAdapter';
import { ChromeQdrantAdapter } from '../qdrant/chromeQdrantAdapter';
import {
    VECTORDB_PROVIDER_STORAGE_KEY,
    VectorDBAdapter,
    VectorDBProvider,
} from './types';

export async function getVectorDBProvider(): Promise<VectorDBProvider> {
    return new Promise((resolve) => {
        chrome.storage.sync.get([VECTORDB_PROVIDER_STORAGE_KEY], (items) => {
            const value = items[VECTORDB_PROVIDER_STORAGE_KEY];
            resolve(value === 'qdrant' ? 'qdrant' : 'milvus');
        });
    });
}

export async function setVectorDBProvider(provider: VectorDBProvider): Promise<void> {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.set({ [VECTORDB_PROVIDER_STORAGE_KEY]: provider }, () => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve();
            }
        });
    });
}

export async function createVectorDBAdapter(collectionName: string): Promise<VectorDBAdapter> {
    const provider = await getVectorDBProvider();
    if (provider === 'qdrant') {
        return new ChromeQdrantAdapter(collectionName);
    }
    return new ChromeMilvusAdapter(collectionName);
}
