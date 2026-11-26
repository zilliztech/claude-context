import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { envManager } from "@zilliz/claude-context-core";
import { createMcpConfig } from "./config.js";

const mcpPackage = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

function withEnvOverride(name: string, value: string | undefined, run: () => void): void {
    const originalValue = process.env[name];

    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }

    try {
        run();
    } finally {
        if (originalValue === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = originalValue;
        }
    }
}

test("uses the MCP package version as the default server version", () => {
    withEnvOverride("MCP_SERVER_VERSION", undefined, () => {
        const config = createMcpConfig();

        assert.equal(config.version, mcpPackage.version);
    });
});

test("allows MCP_SERVER_VERSION to override the package default", () => {
    withEnvOverride("MCP_SERVER_VERSION", "custom-test-version", () => {
        const config = createMcpConfig();

        assert.equal(config.version, "custom-test-version");
    });
});

test("GOOGLE_GENAI_USE_VERTEXAI unset gives geminiUseVertexAI false", (t) => {
    const originalGet = envManager.get.bind(envManager);
    t.mock.method(envManager, "get", (name: string) =>
        name === "GOOGLE_GENAI_USE_VERTEXAI" ? undefined : originalGet(name)
    );

    assert.equal(createMcpConfig().geminiUseVertexAI, false);
});

test("GOOGLE_GENAI_USE_VERTEXAI accepts 'true', 'TRUE' and '1' as true", () => {
    withEnvOverride("GOOGLE_GENAI_USE_VERTEXAI", "true", () => {
        assert.equal(createMcpConfig().geminiUseVertexAI, true);
    });

    withEnvOverride("GOOGLE_GENAI_USE_VERTEXAI", "TRUE", () => {
        assert.equal(createMcpConfig().geminiUseVertexAI, true);
    });

    withEnvOverride("GOOGLE_GENAI_USE_VERTEXAI", "1", () => {
        assert.equal(createMcpConfig().geminiUseVertexAI, true);
    });
});

test("GOOGLE_GENAI_USE_VERTEXAI='false' gives geminiUseVertexAI false", () => {
    withEnvOverride("GOOGLE_GENAI_USE_VERTEXAI", "false", () => {
        const config = createMcpConfig();

        assert.equal(config.geminiUseVertexAI, false);
    });
});

test("GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION land in the config", () => {
    withEnvOverride("GOOGLE_CLOUD_PROJECT", "test-project", () => {
        withEnvOverride("GOOGLE_CLOUD_LOCATION", "us-central1", () => {
            const config = createMcpConfig();

            assert.equal(config.googleCloudProject, "test-project");
            assert.equal(config.googleCloudLocation, "us-central1");
        });
    });
});
