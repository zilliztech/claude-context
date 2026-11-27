import { test } from "node:test";
import assert from "node:assert/strict";
import { VoyageAIReranker } from "@zilliz/claude-context-core";
import { ContextMcpConfig } from "./config.js";
import { createRerankerInstance } from "./reranker.js";

function makeConfig(overrides: Partial<ContextMcpConfig> = {}): ContextMcpConfig {
    return {
        name: "test",
        version: "0.0.0",
        embeddingProvider: "OpenAI",
        embeddingModel: "text-embedding-3-small",
        openaiApiKey: "sk-test",
        ...overrides,
    };
}

test("does not create a reranker when RERANKER_PROVIDER is not set", () => {
    assert.equal(createRerankerInstance(makeConfig({ voyageaiApiKey: "pa-test" })), undefined);
});

test("creates a VoyageAI reranker with the default model", () => {
    const reranker = createRerankerInstance(makeConfig({
        rerankerProvider: "VoyageAI",
        voyageaiApiKey: "pa-test",
    }));

    assert.ok(reranker instanceof VoyageAIReranker);
    assert.equal(reranker.getProvider(), "VoyageAI");
    assert.equal(reranker.getModel(), VoyageAIReranker.DEFAULT_MODEL);
});

test("passes RERANKER_MODEL through to the VoyageAI reranker", () => {
    const reranker = createRerankerInstance(makeConfig({
        rerankerProvider: "VoyageAI",
        rerankerModel: "rerank-2.5-lite",
        voyageaiApiKey: "pa-test",
    }));

    assert.equal(reranker?.getModel(), "rerank-2.5-lite");
});

test("requires VOYAGEAI_API_KEY for the VoyageAI reranker", () => {
    assert.throws(
        () => createRerankerInstance(makeConfig({ rerankerProvider: "VoyageAI" })),
        /VOYAGEAI_API_KEY is required for VoyageAI reranker provider/
    );
});

test("rejects an unsupported reranker provider", () => {
    assert.throws(
        () => createRerankerInstance(makeConfig({ rerankerProvider: "Cohere", voyageaiApiKey: "pa-test" })),
        /Unsupported reranker provider: Cohere\. Supported providers: VoyageAI/
    );
});
