/**
 * Retry an async operation with exponential backoff.
 *
 * Mirrors the retry pattern used in `packages/core/src/vectordb/milvus-vectordb.ts`
 * but generalized for browser-side use (GitHub API, Milvus/Qdrant fetch calls).
 *
 * @param operation  Async function to retry. Receives the attempt number (1-based).
 * @param options    Retry tuning. All optional.
 *   - maxRetries:        max attempts including the first try (default 5)
 *   - initialDelayMs:    delay before the first retry (default 500)
 *   - maxDelayMs:        clamp for backoff (default 30_000)
 *   - backoffMultiplier: multiplier per attempt (default 2)
 *   - jitter:            randomize delay +-25% to avoid thundering herds (default true)
 *   - shouldRetry:       predicate; default retries on any thrown error.
 *                        Useful for opting out of 4xx (caller error) but retrying 5xx / network.
 *   - onRetry:           optional hook for logging/telemetry between attempts.
 */

export interface RetryOptions {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    jitter?: boolean;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export async function retryWithBackoff<T>(
    operation: (attempt: number) => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        maxRetries = 5,
        initialDelayMs = 500,
        maxDelayMs = 30_000,
        backoffMultiplier = 2,
        jitter = true,
        shouldRetry = defaultShouldRetry,
        onRetry,
    } = options;

    let lastError: unknown;
    let delay = initialDelayMs;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation(attempt);
        } catch (error) {
            lastError = error;

            const isLastAttempt = attempt === maxRetries;
            if (isLastAttempt || !shouldRetry(error, attempt)) {
                throw error;
            }

            const wait = jitter ? jitterize(delay) : delay;
            onRetry?.(error, attempt, wait);
            await sleep(wait);
            delay = Math.min(delay * backoffMultiplier, maxDelayMs);
        }
    }

    // Unreachable in practice; the loop returns or throws on every path.
    throw lastError;
}

/**
 * Default predicate: retry on network errors and HTTP 5xx / 429.
 * Skip retry on 4xx (other than 429) since those are usually caller bugs.
 */
function defaultShouldRetry(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof Error) {
        const status = extractStatus(error);
        if (status === undefined) {
            // Network errors, AbortError, TypeError from fetch -> retry.
            return true;
        }
        if (status === 429) return true;
        if (status >= 500) return true;
        return false;
    }
    return true;
}

/**
 * Pull an HTTP status out of common error shapes (custom property, formatted message).
 */
function extractStatus(error: Error): number | undefined {
    const anyErr = error as unknown as { status?: unknown };
    if (typeof anyErr.status === 'number') return anyErr.status;

    // Matches messages like: "Qdrant PUT /... failed: 503 Service Unavailable".
    const match = /\b([45]\d\d)\b/.exec(error.message);
    if (match) return Number(match[1]);

    return undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterize(ms: number): number {
    const span = ms * 0.25;
    return Math.max(0, ms + (Math.random() * 2 - 1) * span);
}
