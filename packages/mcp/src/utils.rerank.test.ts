import assert from "node:assert/strict";
import test from "node:test";

import { isTestPath, isTestSeekingQuery, rerankByCodeRole } from "./utils.js";

test("test, fixture and mock paths are recognised across ecosystems", () => {
    for (const testPath of [
        "tests/nora/test_signal.py",
        "tests/nora/signal/test_utils.py",
        "src/lib/parser.test.ts",
        "src/lib/parser.spec.tsx",
        "packages/core/src/context.abort.test.ts",
        "internal/server/server_test.go",
        "tests/conftest.py",
        "spec/models/user_spec.rb".replace("_spec.rb", "_test.rb"),
        "app/__tests__/render.js",
        "app/__mocks__/fs.js",
        "tests/fixtures/sample.json",
        "internal/testdata/golden.txt",
    ]) {
        assert.equal(isTestPath(testPath), true, `expected a test path: ${testPath}`);
    }
});

test("production code that merely contains the word is not demoted", () => {
    // The regression this guards: a substring match would swallow shipped
    // helper packages and any path with 'test' inside a longer word.
    for (const sourcePath of [
        "src/echelon/nora/testing/harness.py",
        "src/echelon/nora/signal/utils.py",
        "src/contest/leaderboard.ts",
        "src/latest/index.ts",
        "packages/core/src/context.ts",
        "lib/protest.go",
    ]) {
        assert.equal(isTestPath(sourcePath), false, `expected an implementation path: ${sourcePath}`);
    }
});

test("implementation outranks its own tests at comparable relevance", () => {
    const results = [
        { relativePath: "tests/nora/test_signal.py", score: 0.020 },
        { relativePath: "tests/nora/signal/test_utils.py", score: 0.019 },
        { relativePath: "src/echelon/nora/signal/utils.py", score: 0.017 },
    ];

    const ranked = rerankByCodeRole(results);

    assert.equal(ranked[0].relativePath, "src/echelon/nora/signal/utils.py");
    // Demoted, not dropped — the tests are still reachable below it.
    assert.equal(ranked.length, 3);
    assert.deepEqual(
        ranked.slice(1).map((r) => r.relativePath),
        ["tests/nora/test_signal.py", "tests/nora/signal/test_utils.py"]
    );
});

test("a decisively more relevant test still wins", () => {
    // "How do I call this?" is a real query shape, and the penalty is a nudge,
    // not a partition: a test that is far ahead on relevance stays on top.
    const ranked = rerankByCodeRole([
        { relativePath: "tests/test_api.py", score: 0.9 },
        { relativePath: "src/api.py", score: 0.2 },
    ]);

    assert.equal(ranked[0].relativePath, "tests/test_api.py");
});

test("equal scores keep the vector store's ordering", () => {
    const ranked = rerankByCodeRole([
        { relativePath: "src/a.ts", score: 0.5 },
        { relativePath: "src/b.ts", score: 0.5 },
        { relativePath: "src/c.ts", score: 0.5 },
    ]);

    assert.deepEqual(ranked.map((r) => r.relativePath), ["src/a.ts", "src/b.ts", "src/c.ts"]);
});

test("the penalty can be switched off", () => {
    const previous = process.env.CLAUDE_CONTEXT_TEST_RANK_PENALTY;
    process.env.CLAUDE_CONTEXT_TEST_RANK_PENALTY = "1";
    try {
        const ranked = rerankByCodeRole([
            { relativePath: "tests/test_api.py", score: 0.20 },
            { relativePath: "src/api.py", score: 0.19 },
        ]);
        assert.equal(ranked[0].relativePath, "tests/test_api.py");
    } finally {
        if (previous === undefined) delete process.env.CLAUDE_CONTEXT_TEST_RANK_PENALTY;
        else process.env.CLAUDE_CONTEXT_TEST_RANK_PENALTY = previous;
    }
});

test("a query that asks for tests is recognised", () => {
    for (const query of [
        "where do we test entity resolution merging",
        "test coverage for the correction tiers",
        "unit tests for the Cypher builder",
        "fixtures used by the extraction tests",
        "what does conftest.py set up",
        "the spec for the retry decorator",
    ]) {
        assert.equal(isTestSeekingQuery(query), true, `expected test-seeking: ${query}`);
    }

    for (const query of [
        "how is a factoid persisted to the graph",
        "retry with exponential backoff on rate limit",
        "the latest protestor count endpoint",   // 'latest'/'protestor' must not match
    ]) {
        assert.equal(isTestSeekingQuery(query), false, `expected implementation-seeking: ${query}`);
    }
});

test("asking for tests skips the penalty entirely", () => {
    const results = [
        { relativePath: "tests/nora/test_resolution.py", score: 0.20 },
        { relativePath: "src/echelon/nora/memory/resolution.py", score: 0.19 },
    ];

    // Without the query the penalty applies and the implementation is promoted...
    assert.equal(rerankByCodeRole(results)[0].relativePath, "src/echelon/nora/memory/resolution.py");
    // ...but when the caller explicitly asked for tests, demoting them is wrong.
    assert.equal(
        rerankByCodeRole(results, "where do we test entity resolution")[0].relativePath,
        "tests/nora/test_resolution.py"
    );
});

test("an out-of-range penalty falls back to the default instead of inverting the ranking", () => {
    const previous = process.env.CLAUDE_CONTEXT_TEST_RANK_PENALTY;
    process.env.CLAUDE_CONTEXT_TEST_RANK_PENALTY = "-3";
    try {
        const ranked = rerankByCodeRole([
            { relativePath: "tests/test_api.py", score: 0.20 },
            { relativePath: "src/api.py", score: 0.19 },
        ]);
        assert.equal(ranked[0].relativePath, "src/api.py");
    } finally {
        if (previous === undefined) delete process.env.CLAUDE_CONTEXT_TEST_RANK_PENALTY;
        else process.env.CLAUDE_CONTEXT_TEST_RANK_PENALTY = previous;
    }
});
