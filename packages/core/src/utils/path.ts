import * as path from 'path';

/**
 * Normalize a codebase path for file system operations.
 * Handles: MSYS/Git Bash (/c/Users/...), forward slashes, mixed,
 * trailing slashes. Preserves original case.
 */
export function normalizeCodebasePath(inputPath: string): string {
    let p = inputPath;

    // 1. Convert MSYS/Git Bash paths: /c/Users/... -> C:\Users\...
    if (process.platform === 'win32') {
        const msysMatch = p.match(/^\/([a-zA-Z])(\/.*)?$/);
        if (msysMatch) {
            const drive = msysMatch[1].toUpperCase();
            const rest = msysMatch[2] || '';
            p = `${drive}:${rest}`;
        }
    }

    // 2. Resolve to absolute (handles relative paths, .., etc.)
    p = path.resolve(p);

    // 3. Windows-specific slash normalization
    if (process.platform === 'win32') {
        p = p.replace(/\//g, '\\');       // forward -> backslash
        p = p.replace(/\\{2,}/g, '\\');   // collapse multiple backslashes
    }

    // 4. Remove trailing separator
    if (p.length > 1 && (p.endsWith('/') || p.endsWith('\\'))) {
        p = p.slice(0, -1);
    }

    return p;
}

/**
 * Canonical codebase path for hashing/identity comparison.
 * Same as normalizeCodebasePath + lowercase on Windows (case-insensitive FS).
 * Use this ONLY for hash inputs, not for FS operations or display.
 */
export function canonicalCodebasePath(inputPath: string): string {
    let p = normalizeCodebasePath(inputPath);
    if (process.platform === 'win32') {
        p = p.toLowerCase();
    }
    return p;
}

/**
 * Normalize a relative file path to use forward slashes (for DB storage/queries).
 */
export function normalizeRelativePath(relativePath: string): string {
    return relativePath.replace(/\\/g, '/');
}
