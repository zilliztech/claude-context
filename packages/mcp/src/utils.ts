import * as path from "path";

/**
 * Truncate content to specified length
 */
export function truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
        return content;
    }
    return content.substring(0, maxLength) + '...';
}

/**
 * Ensure path is absolute. If relative path is provided, resolve it properly.
 */
export function ensureAbsolutePath(inputPath: string): string {
    // If already absolute, return as is
    if (path.isAbsolute(inputPath)) {
        return inputPath;
    }

    // For relative paths, resolve to absolute path
    const resolved = path.resolve(inputPath);
    return resolved;
}

export function trackCodebasePath(codebasePath: string): void {
    const absolutePath = ensureAbsolutePath(codebasePath);
    console.log(`[TRACKING] Tracked codebase path: ${absolutePath} (not marked as indexed)`);
}

/** Hard ceiling on what we ask the vector store for, per the search tool's contract. */
export const MAX_SEARCH_RESULTS = 50;

/**
 * How much wider than the caller's limit we search before re-ranking. Without
 * headroom a re-rank can only reorder what already won: if tests fill every
 * slot, the implementation is not in the list to be promoted.
 */
export const RERANK_OVERFETCH_FACTOR = 4;

const DEFAULT_TEST_RANK_PENALTY = 0.75;

/** Path segments that mark a file as exercising code rather than being it. */
const TEST_DIR_SEGMENTS = new Set([
    'test', 'tests', '__tests__', '__mocks__', 'testdata', 'fixtures', 'spec', '__fixtures__',
]);

/** Filename shapes for the same, across the ecosystems this indexes. */
const TEST_FILE_PATTERNS = [
    /\.(test|spec)\.[cm]?[jt]sx?$/,   // foo.test.ts, foo.spec.jsx
    /^test_.*\.py$/,                  // pytest
    /_test\.(py|go|rb)$/,             // foo_test.go
    /^conftest\.py$/,
];

/**
 * Is this path a test, fixture or mock rather than the implementation?
 *
 * Matches whole path segments deliberately: a substring match would also catch
 * production packages that merely contain the word, such as `src/.../testing/`
 * (a shipped helper module) or `contest/`.
 */
export function isTestPath(relativePath: string): boolean {
    const segments = relativePath.split(/[\\/]/);
    const fileName = segments[segments.length - 1] ?? '';

    if (segments.slice(0, -1).some((segment) => TEST_DIR_SEGMENTS.has(segment.toLowerCase()))) {
        return true;
    }
    return TEST_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

function getTestRankPenalty(): number {
    const raw = process.env.CLAUDE_CONTEXT_TEST_RANK_PENALTY;
    if (!raw) return DEFAULT_TEST_RANK_PENALTY;

    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        console.warn(
            `[SEARCH] Invalid CLAUDE_CONTEXT_TEST_RANK_PENALTY '${raw}' (want 0..1). ` +
            `Falling back to ${DEFAULT_TEST_RANK_PENALTY}.`
        );
        return DEFAULT_TEST_RANK_PENALTY;
    }
    return value;
}

const TEST_SEEKING_QUERY = /\b(tests?|testing|tested|specs?|fixtures?|mocks?|coverage|conftest)\b/i;

/**
 * Did the caller ask for tests? Demoting them would then be actively wrong.
 *
 * Measured: without this, "where do we test entity resolution merging" and
 * friends lose test hits they should be getting — one such query dropped tests
 * out of its top 5 entirely.
 */
export function isTestSeekingQuery(query: string): boolean {
    return TEST_SEEKING_QUERY.test(query);
}

/**
 * Push tests below implementation at comparable relevance.
 *
 * A test restates the query's vocabulary almost literally — the error strings,
 * the option names, the call itself — while the implementation encodes the
 * mechanism and often names none of it. Pure embedding similarity therefore
 * rewards the test, and for a query like "retry with exponential backoff when
 * the API returns a rate limit error" the whole result page came back as test
 * call sites while the decorator that implements it never appeared at all.
 *
 * This demotes, never excludes: sometimes the test *is* the answer ("how do I
 * call this?"), so it should still be reachable, just not ahead of the thing it
 * tests. A query that asks for tests outright skips the penalty entirely, and
 * CLAUDE_CONTEXT_TEST_RANK_PENALTY=1 disables it everywhere.
 */
export function rerankByCodeRole<T extends { relativePath: string; score: number }>(
    results: T[],
    query?: string
): T[] {
    const penalty = getTestRankPenalty();
    if (penalty === 1) return results;
    if (query !== undefined && isTestSeekingQuery(query)) return results;

    return results
        .map((result, position) => ({
            result,
            position,
            adjusted: isTestPath(result.relativePath) ? result.score * penalty : result.score,
        }))
        // Ties keep the vector store's own ordering rather than reshuffling on
        // float noise, so the ranking stays reproducible between identical runs.
        .sort((a, b) => (b.adjusted - a.adjusted) || (a.position - b.position))
        .map((entry) => entry.result);
}

/**
 * Markers of "the vector database is not reachable", as opposed to any other
 * failure. The Milvus gRPC client reports an unreachable backend as status 14
 * UNAVAILABLE wrapping a socket-level cause, so match on both layers.
 */
const BACKEND_UNREACHABLE_MARKERS = [
    'UNAVAILABLE',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'No connection established',
    'Connection refused',
];

export function isBackendUnreachableError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    // gRPC status 14 is UNAVAILABLE; the SDK exposes it as a numeric `code`.
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 14) {
        return true;
    }
    return BACKEND_UNREACHABLE_MARKERS.some((marker) => message.includes(marker));
}

/**
 * Turn a tool failure into text the caller can act on.
 *
 * A down backend used to surface as "check if the codebase has been indexed
 * first", which points at the one thing that is *not* wrong — the index is
 * intact and the address simply refuses connections. An agent that reads the
 * old message re-indexes, fails again, and concludes the tool is useless.
 */
export function describeToolError(error: unknown, action: string): string {
    const message = error instanceof Error ? error.message : String(error);
    if (isBackendUnreachableError(error)) {
        const address = process.env.MILVUS_ADDRESS || 'the configured MILVUS_ADDRESS';
        return `Error ${action}: the code index backend at ${address} is unreachable (${message}). ` +
            `The index itself is fine — the vector database is not running. Start it with \`codeindex up\`, ` +
            `then retry. Do NOT re-index: that will fail the same way.`;
    }
    return `Error ${action}: ${message}`;
}