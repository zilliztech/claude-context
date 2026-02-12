import { normalizeCodebasePath } from "@zilliz/claude-context-core";

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
 * Ensure path is absolute and normalized for consistent cross-client usage.
 * Handles MSYS/Git Bash paths, forward slashes, mixed separators on Windows.
 */
export function ensureAbsolutePath(inputPath: string): string {
    return normalizeCodebasePath(inputPath);
}

export function trackCodebasePath(codebasePath: string): void {
    const absolutePath = ensureAbsolutePath(codebasePath);
    console.log(`[TRACKING] Tracked codebase path: ${absolutePath} (not marked as indexed)`);
} 