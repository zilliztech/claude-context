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
    // Convert input path to lowercase
    inputPath = inputPath.toLowerCase();
    // If already absolute, return as is with normalized slashes
    if (path.isAbsolute(inputPath)) {
        return inputPath.replace(/\\/g, '/');
    }

    // For relative paths, resolve to absolute path and normalize slashes
    const resolved = path.resolve(inputPath);
    return resolved.replace(/\\/g, '/');
}

export function trackCodebasePath(codebasePath: string): void {
    const absolutePath = ensureAbsolutePath(codebasePath);
    console.log(`[TRACKING] Tracked codebase path: ${absolutePath} (not marked as indexed)`);
} 