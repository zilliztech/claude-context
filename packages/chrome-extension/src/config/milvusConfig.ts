export interface MilvusConfig {
    address: string;
    token?: string;
    username?: string;
    password?: string;
    database?: string;
}

export interface ChromeStorageConfig {
    githubToken?: string;
    openaiToken?: string;
    milvusAddress?: string;
    milvusToken?: string;
    milvusUsername?: string;
    milvusPassword?: string;
    milvusDatabase?: string;
}

export class MilvusConfigManager {
    /**
     * Get Milvus configuration from Chrome storage
     */
    static async getMilvusConfig(): Promise<MilvusConfig | null> {
        return new Promise((resolve) => {
            chrome.storage.local.get([
                'milvusAddress',
                'milvusToken',
                'milvusUsername',
                'milvusPassword',
                'milvusDatabase'
            ], (items: ChromeStorageConfig) => {
                if (chrome.runtime.lastError) {
                    console.error('Error loading Milvus config:', chrome.runtime.lastError);
                    resolve(null);
                    return;
                }

                if (!items.milvusAddress) {
                    chrome.storage.sync.get([
                        'milvusAddress',
                        'milvusToken',
                        'milvusUsername',
                        'milvusPassword',
                        'milvusDatabase'
                    ], (syncItems: ChromeStorageConfig) => {
                        if (chrome.runtime.lastError) {
                            console.error('Error loading Milvus config:', chrome.runtime.lastError);
                            resolve(null);
                            return;
                        }

                        if (!syncItems.milvusAddress) {
                            resolve(null);
                            return;
                        }

                        chrome.storage.local.set({
                            milvusAddress: syncItems.milvusAddress,
                            milvusToken: syncItems.milvusToken,
                            milvusUsername: syncItems.milvusUsername,
                            milvusPassword: syncItems.milvusPassword,
                            milvusDatabase: syncItems.milvusDatabase || 'default'
                        }, () => {
                            if (chrome.runtime.lastError) {
                                console.error('Error migrating Milvus config:', chrome.runtime.lastError);
                                return;
                            }

                            chrome.storage.sync.remove([
                                'milvusAddress',
                                'milvusToken',
                                'milvusUsername',
                                'milvusPassword',
                                'milvusDatabase'
                            ]);
                        });

                        const config: MilvusConfig = {
                            address: syncItems.milvusAddress,
                            token: syncItems.milvusToken,
                            username: syncItems.milvusUsername,
                            password: syncItems.milvusPassword,
                            database: syncItems.milvusDatabase || 'default'
                        };

                        resolve(config);
                    });
                    return;
                }

                const config: MilvusConfig = {
                    address: items.milvusAddress,
                    token: items.milvusToken,
                    username: items.milvusUsername,
                    password: items.milvusPassword,
                    database: items.milvusDatabase || 'default'
                };

                resolve(config);
            });
        });
    }

    /**
     * Save Milvus configuration to Chrome storage
     */
    static async saveMilvusConfig(config: MilvusConfig): Promise<void> {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({
                milvusAddress: config.address,
                milvusToken: config.token,
                milvusUsername: config.username,
                milvusPassword: config.password,
                milvusDatabase: config.database || 'default'
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    chrome.storage.sync.remove([
                        'milvusAddress',
                        'milvusToken',
                        'milvusUsername',
                        'milvusPassword',
                        'milvusDatabase'
                    ], () => {
                        resolve();
                    });
                }
            });
        });
    }

    /**
     * Get OpenAI configuration
     */
    static async getOpenAIConfig(): Promise<{ apiKey: string; model: string } | null> {
        return new Promise((resolve) => {
            chrome.storage.local.get(['openaiToken'], (items: ChromeStorageConfig) => {
                if (chrome.runtime.lastError) {
                    resolve(null);
                    return;
                }

                if (!items.openaiToken) {
                    chrome.storage.sync.get(['openaiToken'], (syncItems: ChromeStorageConfig) => {
                        if (chrome.runtime.lastError || !syncItems.openaiToken) {
                            resolve(null);
                            return;
                        }

                        chrome.storage.local.set({ openaiToken: syncItems.openaiToken }, () => {
                            if (chrome.runtime.lastError) {
                                return;
                            }

                            chrome.storage.sync.remove(['openaiToken']);
                        });

                        resolve({
                            apiKey: syncItems.openaiToken,
                            model: 'text-embedding-3-small' // Default model
                        });
                    });
                    return;
                }

                resolve({
                    apiKey: items.openaiToken,
                    model: 'text-embedding-3-small' // Default model
                });
            });
        });
    }

    /**
     * Validate Milvus configuration
     */
    static validateMilvusConfig(config: MilvusConfig): boolean {
        if (!config.address) {
            return false;
        }

        // For basic validation, just check if address is provided
        // Authentication can be optional for local instances
        return true;
    }
}
