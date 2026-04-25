/**
 * Qdrant configuration for Chrome Extension
 * Mirrors the shape of MilvusConfig so background.ts can switch via VECTORDB_PROVIDER.
 */

export interface QdrantConfig {
    url: string;        // Full URL e.g. https://qdrant.example.com:6333
    apiKey?: string;    // Optional, required for Qdrant Cloud / secured deployments
}

export interface QdrantStorageKeys {
    qdrantUrl?: string;
    qdrantApiKey?: string;
}

export class QdrantConfigManager {
    private static readonly STORAGE_KEYS = ['qdrantUrl', 'qdrantApiKey'] as const;

    /**
     * Read Qdrant config from chrome.storage.sync.
     * Returns null when no URL is configured.
     */
    static async getQdrantConfig(): Promise<QdrantConfig | null> {
        return new Promise((resolve) => {
            chrome.storage.sync.get(this.STORAGE_KEYS as unknown as string[], (items: QdrantStorageKeys) => {
                if (!items.qdrantUrl) {
                    resolve(null);
                    return;
                }
                resolve({
                    url: items.qdrantUrl,
                    apiKey: items.qdrantApiKey,
                });
            });
        });
    }

    /**
     * Persist Qdrant config to chrome.storage.sync.
     */
    static async setQdrantConfig(config: QdrantConfig): Promise<void> {
        return new Promise((resolve, reject) => {
            const items: QdrantStorageKeys = {
                qdrantUrl: config.url,
                qdrantApiKey: config.apiKey,
            };
            chrome.storage.sync.set(items, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Validate that a config has all required fields and a parseable URL.
     */
    static validateQdrantConfig(config: QdrantConfig | null): config is QdrantConfig {
        if (!config || !config.url) return false;
        try {
            const u = new URL(config.url);
            return u.protocol === 'http:' || u.protocol === 'https:';
        } catch {
            return false;
        }
    }
}
