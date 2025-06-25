import * as vscode from 'vscode';
import { OpenAIEmbedding, OpenAIEmbeddingConfig, VoyageAIEmbedding, VoyageAIEmbeddingConfig, OllamaEmbedding, OllamaEmbeddingConfig, MilvusConfig } from '@code-indexer/core';

// Simplified Milvus configuration interface for frontend
export interface MilvusWebConfig {
    address: string;
    token?: string;
}

export type EmbeddingProviderConfig = {
    provider: 'OpenAI';
    config: OpenAIEmbeddingConfig;
} | {
    provider: 'VoyageAI';
    config: VoyageAIEmbeddingConfig;
} | {
    provider: 'Ollama';
    config: OllamaEmbeddingConfig;
};

export interface PluginConfig {
    embeddingProvider?: EmbeddingProviderConfig;
    milvusConfig?: MilvusWebConfig;
}

type FieldDefinition = {
    name: string;
    type: string;
    description: string;
    inputType?: 'text' | 'password' | 'url' | 'select';
    placeholder?: string;
    required?: boolean;
};

// Unified provider configuration
const PROVIDERS = {
    'OpenAI': {
        name: 'OpenAI',
        class: OpenAIEmbedding,
        requiredFields: [
            { name: 'model', type: 'string', description: 'Model name to use', inputType: 'select', required: true },
            { name: 'apiKey', type: 'string', description: 'OpenAI API key', inputType: 'password', required: true }
        ] as FieldDefinition[],
        optionalFields: [
            { name: 'baseURL', type: 'string', description: 'Custom API endpoint URL (optional)', inputType: 'url', placeholder: 'https://api.openai.com/v1' }
        ] as FieldDefinition[],
        defaultConfig: {
            model: 'text-embedding-3-small'
        }
    },
    'VoyageAI': {
        name: 'VoyageAI',
        class: VoyageAIEmbedding,
        requiredFields: [
            { name: 'model', type: 'string', description: 'Model name to use', inputType: 'select', required: true },
            { name: 'apiKey', type: 'string', description: 'VoyageAI API key', inputType: 'password', required: true }
        ] as FieldDefinition[],
        optionalFields: [] as FieldDefinition[],
        defaultConfig: {
            model: 'voyage-code-3'
        }
    },
    'Ollama': {
        name: 'Ollama',
        class: OllamaEmbedding,
        requiredFields: [
            { name: 'model', type: 'string', description: 'Model name (e.g., nomic-embed-text, mxbai-embed-large)', inputType: 'text', required: true, placeholder: 'nomic-embed-text' }
        ] as FieldDefinition[],
        optionalFields: [
            { name: 'host', type: 'string', description: 'Ollama server host URL', inputType: 'url', placeholder: 'http://127.0.0.1:11434' },
            { name: 'keepAlive', type: 'string', description: 'Keep model alive duration', inputType: 'text', placeholder: '5m' }
        ] as FieldDefinition[],
        defaultConfig: {
            model: 'nomic-embed-text',
            host: 'http://127.0.0.1:11434',
            keepAlive: '5m'
        }
    }
} as const;

export class ConfigManager {
    private static readonly CONFIG_KEY = 'semanticCodeSearch';
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Get provider configuration information
     */
    private static getProviderInfo(provider: string) {
        if (!(provider in PROVIDERS)) {
            return null;
        }
        return PROVIDERS[provider as keyof typeof PROVIDERS];
    }

    /**
     * Build configuration object
     */
    private buildConfigObject(provider: string, vscodeConfig: vscode.WorkspaceConfiguration): any {
        const providerInfo = ConfigManager.getProviderInfo(provider);
        if (!providerInfo) return null;

        const configObject: any = { ...providerInfo.defaultConfig };
        const allFields = [...providerInfo.requiredFields, ...providerInfo.optionalFields];

        // Read values for all fields
        for (const field of allFields) {
            const value = vscodeConfig.get<any>(`embeddingProvider.${field.name}`);
            if (value !== undefined) {
                configObject[field.name] = value;
            }
        }

        // Validate required fields
        for (const field of providerInfo.requiredFields) {
            if (!configObject[field.name]) {
                return null;
            }
        }

        return configObject;
    }

    /**
     * Get embedding provider configuration
     */
    getEmbeddingProviderConfig(): EmbeddingProviderConfig | undefined {
        const config = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);
        const provider = config.get<string>('embeddingProvider.provider');

        if (!provider) return undefined;

        const configObject = this.buildConfigObject(provider, config);
        if (!configObject) return undefined;

        return {
            provider: provider as 'OpenAI' | 'VoyageAI' | 'Ollama',
            config: configObject
        };
    }

    /**
     * Save embedding provider configuration
     */
    async saveEmbeddingProviderConfig(providerConfig: EmbeddingProviderConfig): Promise<void> {
        // Defensive checks
        if (!providerConfig) {
            throw new Error('Provider config is undefined');
        }

        if (!providerConfig.config) {
            throw new Error('Provider config.config is undefined');
        }

        const workspaceConfig = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);
        const { provider, config } = providerConfig;

        const providerInfo = ConfigManager.getProviderInfo(provider);
        if (!providerInfo) {
            throw new Error(`Unknown provider: ${provider}`);
        }

        // Save provider type
        await workspaceConfig.update('embeddingProvider.provider', provider, vscode.ConfigurationTarget.Global);

        // Save all fields
        const allFields = [...providerInfo.requiredFields, ...providerInfo.optionalFields];
        for (const field of allFields) {
            const value = (config as any)[field.name];

            // For empty strings, save undefined to avoid validation errors
            const saveValue = (value === '' || value === null) ? undefined : value;

            await workspaceConfig.update(
                `embeddingProvider.${field.name}`,
                saveValue,
                vscode.ConfigurationTarget.Global
            );
        }
    }

    /**
     * Create embedding instance
     */
    static createEmbeddingInstance(provider: string, config: any): any {
        const providerInfo = ConfigManager.getProviderInfo(provider);
        if (!providerInfo) {
            throw new Error(`Unknown provider: ${provider}`);
        }
        return new providerInfo.class(config);
    }


    /**
     * Get supported embedding providers
     */
    static getSupportedProviders(): Record<string, {
        name: string;
        models: Record<string, any>;
        requiredFields: FieldDefinition[];
        optionalFields: FieldDefinition[];
        defaultConfig: any;
    }> {
        const result: any = {};

        for (const [providerKey, providerInfo] of Object.entries(PROVIDERS)) {
            // Ollama doesn't have getSupportedModels since users input model names manually
            const models = providerKey === 'Ollama' ? {} : (providerInfo.class as any).getSupportedModels();

            result[providerKey] = {
                name: providerInfo.name,
                models: models,
                requiredFields: [...providerInfo.requiredFields],
                optionalFields: [...providerInfo.optionalFields],
                defaultConfig: providerInfo.defaultConfig
            };
        }

        return result;
    }


    /**
     * Get Milvus frontend configuration
     */
    getMilvusConfig(): MilvusWebConfig | undefined {
        const config = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);
        const address = config.get<string>('milvus.address');
        const token = config.get<string>('milvus.token');

        if (!address) return undefined;

        return {
            address,
            token
        };
    }

    /**
     * Save Milvus frontend configuration
     */
    async saveMilvusConfig(milvusConfig: MilvusWebConfig): Promise<void> {
        if (!milvusConfig) {
            throw new Error('Milvus config is undefined');
        }

        if (!milvusConfig.address) {
            throw new Error('Milvus address is required');
        }

        const workspaceConfig = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);

        await workspaceConfig.update('milvus.address', milvusConfig.address, vscode.ConfigurationTarget.Global);
        await workspaceConfig.update('milvus.token', milvusConfig.token ?? undefined, vscode.ConfigurationTarget.Global);
    }

    /**
     * Convert frontend configuration to complete MilvusConfig
     */
    getMilvusFullConfig(): MilvusConfig | undefined {
        const webConfig = this.getMilvusConfig();
        if (!webConfig) return undefined;

        // Convert simplified frontend config to complete config with reasonable defaults
        return {
            address: webConfig.address,
            token: webConfig.token,
            // Set default values
            ssl: webConfig.address.startsWith('https://'), // Enable SSL if https address
            // username and password are usually handled via token, so not set
        };
    }

} 