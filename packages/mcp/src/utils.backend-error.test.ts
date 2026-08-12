import assert from "node:assert/strict";
import test from "node:test";

import { describeToolError, isBackendUnreachableError } from "./utils.js";

// The shape the Milvus SDK actually produces when the backend is stopped —
// captured verbatim from a server started against a closed port.
function grpcUnavailable(): Error & { code: number } {
    const error = new Error(
        '14 UNAVAILABLE: No connection established. Last error: Error: connect ECONNREFUSED 127.0.0.1:19530'
    ) as Error & { code: number };
    error.code = 14;
    return error;
}

test("a stopped backend is recognised through both the gRPC status and the socket cause", () => {
    assert.equal(isBackendUnreachableError(grpcUnavailable()), true);
    assert.equal(isBackendUnreachableError(new Error('connect ECONNREFUSED 127.0.0.1:19530')), true);
    assert.equal(isBackendUnreachableError(new Error('getaddrinfo ENOTFOUND milvus.internal')), true);

    // A numeric gRPC code alone is enough: the message wording is not stable.
    const bare = new Error('rpc failed') as Error & { code: number };
    bare.code = 14;
    assert.equal(isBackendUnreachableError(bare), true);
});

test("ordinary failures are not mistaken for an unreachable backend", () => {
    assert.equal(isBackendUnreachableError(new Error('collection not found')), false);
    assert.equal(isBackendUnreachableError(new Error('dimension mismatch: 768 vs 1536')), false);
    assert.equal(isBackendUnreachableError('some string failure'), false);
});

test("an unreachable backend is reported as such, and steers away from re-indexing", () => {
    const previous = process.env.MILVUS_ADDRESS;
    process.env.MILVUS_ADDRESS = '127.0.0.1:19530';
    try {
        const text = describeToolError(grpcUnavailable(), 'searching code');

        // Names the real problem and the address, so the reader can check it.
        assert.match(text, /unreachable/);
        assert.match(text, /127\.0\.0\.1:19530/);
        // Points at the one command that fixes it.
        assert.match(text, /codeindex up/);
        // The old text sent readers to re-index, which is exactly the wrong move
        // and fails identically — this is the regression being guarded.
        assert.doesNotMatch(text, /has been indexed first/);
    } finally {
        if (previous === undefined) delete process.env.MILVUS_ADDRESS;
        else process.env.MILVUS_ADDRESS = previous;
    }
});

test("unrelated failures keep their original message", () => {
    const text = describeToolError(new Error('collection not found'), 'clearing index');
    assert.equal(text, 'Error clearing index: collection not found');
});
