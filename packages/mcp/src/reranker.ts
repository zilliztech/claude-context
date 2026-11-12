import { Reranker, VoyageAIReranker } from "@zilliz/claude-context-core";
import { ContextMcpConfig } from "./config.js";

export const SUPPORTED_RERANKER_PROVIDERS = ['VoyageAI'] as const;

// Helper function to create the optional reranker based on RERANKER_PROVIDER.
// Returns undefined when no reranker is configured, so search keeps its current behaviour.
export function createRerankerInstance(config: ContextMcpConfig): Reranker | undefined {
    if (!config.rerankerProvider) {
        return undefined;
    }

    console.log(`[RERANKER] Creating ${config.rerankerProvider} reranker instance...`);

    switch (config.rerankerProvider) {
        case 'VoyageAI': {
            if (!config.voyageaiApiKey) {
                console.error(`[RERANKER] ❌ VoyageAI API key is required but not provided`);
                throw new Error('VOYAGEAI_API_KEY is required for VoyageAI reranker provider');
            }
            const reranker = new VoyageAIReranker({
                apiKey: config.voyageaiApiKey,
                ...(config.rerankerModel && { model: config.rerankerModel })
            });
            console.log(`[RERANKER] ✅ VoyageAI reranker instance created with model: ${reranker.getModel()}`);
            return reranker;
        }

        default:
            console.error(`[RERANKER] ❌ Unsupported reranker provider: ${config.rerankerProvider}`);
            throw new Error(`Unsupported reranker provider: ${config.rerankerProvider}. Supported providers: ${SUPPORTED_RERANKER_PROVIDERS.join(', ')}`);
    }
}
