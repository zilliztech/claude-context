import { OpenAIEmbedding, AzureOpenAIEmbedding, VoyageAIEmbedding, GeminiEmbedding, OllamaEmbedding } from "@zilliz/claude-context-core";
import { ContextMcpConfig } from "./config.js";

// Helper function to create embedding instance based on provider
export function createEmbeddingInstance(config: ContextMcpConfig): OpenAIEmbedding | AzureOpenAIEmbedding | VoyageAIEmbedding | GeminiEmbedding | OllamaEmbedding {
    console.log(`[EMBEDDING] Creating ${config.embeddingProvider} embedding instance...`);

    switch (config.embeddingProvider) {
        case 'OpenAI':
            if (!config.openaiApiKey) {
                console.error(`[EMBEDDING] ❌ OpenAI API key is required but not provided`);
                throw new Error('OPENAI_API_KEY is required for OpenAI embedding provider');
            }
            console.log(`[EMBEDDING] 🔧 Configuring OpenAI with model: ${config.embeddingModel}`);
            const openaiEmbedding = new OpenAIEmbedding({
                apiKey: config.openaiApiKey,
                model: config.embeddingModel,
                ...(config.openaiBaseUrl && { baseURL: config.openaiBaseUrl })
            });
            console.log(`[EMBEDDING] ✅ OpenAI embedding instance created successfully`);
            return openaiEmbedding;

        case 'AzureOpenAI':
            if (!config.azureOpenaiEndpoint) {
                console.error(`[EMBEDDING] ❌ Azure OpenAI endpoint is required but not provided`);
                throw new Error('AZURE_OPENAI_ENDPOINT is required for Azure OpenAI embedding provider');
            }
            if (!config.azureOpenaiApiKey) {
                console.error(`[EMBEDDING] ❌ Azure OpenAI API key is required but not provided`);
                throw new Error('AZURE_OPENAI_API_KEY is required for Azure OpenAI embedding provider');
            }
            if (!config.azureOpenaiDeploymentName && !config.embeddingModel) {
                console.error(`[EMBEDDING] ❌ Azure OpenAI deployment name is required but not provided`);
                throw new Error('AZURE_OPENAI_DEPLOYMENT_NAME or EMBEDDING_MODEL is required for Azure OpenAI embedding provider');
            }
            
            console.log(`[EMBEDDING] 🔧 Configuring Azure OpenAI with deployment: ${config.azureOpenaiDeploymentName || config.embeddingModel}`);
            const azureOpenaiEmbedding = new AzureOpenAIEmbedding({
                deploymentName: config.azureOpenaiDeploymentName || config.embeddingModel,
                azureEndpoint: config.azureOpenaiEndpoint,
                apiVersion: config.azureOpenaiApiVersion,
                apiKey: config.azureOpenaiApiKey,
            });
            console.log(`[EMBEDDING] ✅ Azure OpenAI embedding instance created successfully`);
            return azureOpenaiEmbedding;

        case 'VoyageAI':
            if (!config.voyageaiApiKey) {
                console.error(`[EMBEDDING] ❌ VoyageAI API key is required but not provided`);
                throw new Error('VOYAGEAI_API_KEY is required for VoyageAI embedding provider');
            }
            console.log(`[EMBEDDING] 🔧 Configuring VoyageAI with model: ${config.embeddingModel}`);
            const voyageEmbedding = new VoyageAIEmbedding({
                apiKey: config.voyageaiApiKey,
                model: config.embeddingModel
            });
            console.log(`[EMBEDDING] ✅ VoyageAI embedding instance created successfully`);
            return voyageEmbedding;

        case 'Gemini':
            if (!config.geminiApiKey) {
                console.error(`[EMBEDDING] ❌ Gemini API key is required but not provided`);
                throw new Error('GEMINI_API_KEY is required for Gemini embedding provider');
            }
            console.log(`[EMBEDDING] 🔧 Configuring Gemini with model: ${config.embeddingModel}`);
            const geminiEmbedding = new GeminiEmbedding({
                apiKey: config.geminiApiKey,
                model: config.embeddingModel,
                ...(config.geminiBaseUrl && { baseURL: config.geminiBaseUrl })
            });
            console.log(`[EMBEDDING] ✅ Gemini embedding instance created successfully`);
            return geminiEmbedding;

        case 'Ollama':
            const ollamaHost = config.ollamaHost || 'http://127.0.0.1:11434';
            console.log(`[EMBEDDING] 🔧 Configuring Ollama with model: ${config.embeddingModel}, host: ${ollamaHost}`);
            const ollamaEmbedding = new OllamaEmbedding({
                model: config.embeddingModel,
                host: config.ollamaHost
            });
            console.log(`[EMBEDDING] ✅ Ollama embedding instance created successfully`);
            return ollamaEmbedding;

        default:
            console.error(`[EMBEDDING] ❌ Unsupported embedding provider: ${config.embeddingProvider}`);
            throw new Error(`Unsupported embedding provider: ${config.embeddingProvider}`);
    }
}

export function logEmbeddingProviderInfo(config: ContextMcpConfig, embedding: OpenAIEmbedding | AzureOpenAIEmbedding | VoyageAIEmbedding | GeminiEmbedding | OllamaEmbedding): void {
    console.log(`[EMBEDDING] ✅ Successfully initialized ${config.embeddingProvider} embedding provider`);
    console.log(`[EMBEDDING] Provider details - Model: ${config.embeddingModel}, Dimension: ${embedding.getDimension()}`);

    // Log provider-specific configuration details
    switch (config.embeddingProvider) {
        case 'OpenAI':
            console.log(`[EMBEDDING] OpenAI configuration - API Key: ${config.openaiApiKey ? '✅ Provided' : '❌ Missing'}, Base URL: ${config.openaiBaseUrl || 'Default'}`);
            break;
        case 'AzureOpenAI':
            console.log(`[EMBEDDING] Azure OpenAI configuration - API Key: ${config.azureOpenaiApiKey ? '✅ Provided' : '❌ Missing'}, Endpoint: ${config.azureOpenaiEndpoint}, Deployment: ${config.azureOpenaiDeploymentName || config.embeddingModel}`);
            break;
        case 'VoyageAI':
            console.log(`[EMBEDDING] VoyageAI configuration - API Key: ${config.voyageaiApiKey ? '✅ Provided' : '❌ Missing'}`);
            break;
        case 'Gemini':
            console.log(`[EMBEDDING] Gemini configuration - API Key: ${config.geminiApiKey ? '✅ Provided' : '❌ Missing'}, Base URL: ${config.geminiBaseUrl || 'Default'}`);
            break;
        case 'Ollama':
            console.log(`[EMBEDDING] Ollama configuration - Host: ${config.ollamaHost || 'http://127.0.0.1:11434'}, Model: ${config.embeddingModel}`);
            break;
    }
} 