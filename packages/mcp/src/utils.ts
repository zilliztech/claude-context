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
 * Ensure path is absolute and safe. If relative path is provided, resolve it properly.
 * Includes basic checks to prevent accessing highly sensitive system directories.
 */
export function ensureAbsolutePath(inputPath: string): string {
    const resolved = path.isAbsolute(inputPath) ? inputPath : path.resolve(inputPath);
    const normalized = path.normalize(resolved);

    // Basic safety check for sensitive system paths (Unix-like and Windows)
    const sensitivePaths = [
        "/etc", "/var/private", "/root",
        "C:\\Windows", "C:\\Users\\Administrator"
    ];

    if (sensitivePaths.some(p => normalized.startsWith(p))) {
        throw new Error(`Access to sensitive system path denied: ${normalized}`);
    }

    return normalized;
}

export function trackCodebasePath(codebasePath: string): void {
    const absolutePath = ensureAbsolutePath(codebasePath);
    console.log(`[TRACKING] Tracked codebase path: ${absolutePath} (not marked as indexed)`);
} 
