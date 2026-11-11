import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
