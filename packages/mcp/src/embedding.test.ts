import { test } from "node:test";
import assert from "node:assert/strict";
import { GeminiEmbedding } from "@zilliz/claude-context-core";
import { createEmbeddingInstance } from "./embedding.js";
import { ContextMcpConfig } from "./config.js";

const ISOLATED_ENV_KEYS = [
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
];

function withIsolatedGeminiEnv(run: () => void): void {
    const originalValues = new Map<string, string | undefined>();
    for (const key of ISOLATED_ENV_KEYS) {
        originalValues.set(key, process.env[key]);
        delete process.env[key];
    }

    try {
        run();
    } finally {
        for (const key of ISOLATED_ENV_KEYS) {
            const originalValue = originalValues.get(key);
            if (originalValue === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalValue;
            }
        }
    }
}

function createBaseConfig(overrides: Partial<ContextMcpConfig> = {}): ContextMcpConfig {
    return {
        name: "Test MCP Server",
        version: "0.0.0-test",
        embeddingProvider: "Gemini",
        embeddingModel: "gemini-embedding-001",
        ...overrides,
    };
}

test("Gemini with Vertex AI, project and location creates a Vertex-backed instance without an API key", () => {
    withIsolatedGeminiEnv(() => {
        const config = createBaseConfig({
            geminiUseVertexAI: true,
            googleCloudProject: "test-project",
            googleCloudLocation: "us-central1",
        });

        const embedding = createEmbeddingInstance(config);

        assert.equal(embedding.getProvider(), "Gemini");
        assert.equal((embedding as GeminiEmbedding).getClient().vertexai, true);
    });
});

test("Vertex AI without GOOGLE_CLOUD_LOCATION throws", () => {
    withIsolatedGeminiEnv(() => {
        const config = createBaseConfig({
            geminiUseVertexAI: true,
            googleCloudProject: "test-project",
        });

        assert.throws(() => createEmbeddingInstance(config), /GOOGLE_CLOUD_LOCATION/);
    });
});

test("Vertex AI without GOOGLE_CLOUD_PROJECT throws", () => {
    withIsolatedGeminiEnv(() => {
        const config = createBaseConfig({
            geminiUseVertexAI: true,
            googleCloudLocation: "us-central1",
        });

        assert.throws(() => createEmbeddingInstance(config), /GOOGLE_CLOUD_PROJECT/);
    });
});

test("neither geminiApiKey nor Vertex AI throws", () => {
    withIsolatedGeminiEnv(() => {
        const config = createBaseConfig();

        assert.throws(() => createEmbeddingInstance(config), /GEMINI_API_KEY/);
    });
});

test("geminiApiKey without Vertex AI returns an API-key-backed instance", () => {
    withIsolatedGeminiEnv(() => {
        const config = createBaseConfig({
            geminiApiKey: "test-api-key",
        });

        const embedding = createEmbeddingInstance(config);

        assert.equal((embedding as GeminiEmbedding).getClient().vertexai, false);
    });
});
