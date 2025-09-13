import * as path from "path";
import { execSync } from "child_process";
import * as fs from "fs";

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

/**
 * Check if a directory is a git repository
 */
export function isGitRepository(dirPath: string): boolean {
    try {
        const gitDir = path.join(dirPath, '.git');
        return fs.existsSync(gitDir);
    } catch {
        return false;
    }
}

/**
 * Extract git remote URL from a repository path
 * @param repoPath Path to the git repository
 * @returns Git remote URL or null if not a git repo or no remote
 */
export function extractGitRemoteUrl(repoPath: string): string | null {
    try {
        if (!isGitRepository(repoPath)) {
            return null;
        }

        // Try to get the origin remote URL
        const result = execSync('git remote get-url origin', {
            cwd: repoPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'] // Ignore stderr to suppress git errors
        }).trim();

        return result || null;
    } catch {
        // If no origin remote or git command fails, return null
        return null;
    }
}

/**
 * Parse and normalize a git URL to a standard identifier
 * Handles various formats:
 * - https://github.com/org/repo.git
 * - git@github.com:org/repo.git
 * - https://gitlab.com/org/repo
 *
 * @param gitUrl The git remote URL
 * @returns Normalized identifier like "github.com/org/repo"
 */
export function parseGitUrl(gitUrl: string): string | null {
    try {
        // Remove trailing whitespace
        gitUrl = gitUrl.trim();

        // Handle SSH format (git@github.com:org/repo.git)
        const sshMatch = gitUrl.match(/^git@([^:]+):(.+?)(\.git)?$/);
        if (sshMatch) {
            const host = sshMatch[1];
            const path = sshMatch[2];
            return `${host}/${path}`;
        }

        // Handle HTTPS format (https://github.com/org/repo.git)
        const httpsMatch = gitUrl.match(/^https?:\/\/([^\/]+)\/(.+?)(\.git)?$/);
        if (httpsMatch) {
            const host = httpsMatch[1];
            const path = httpsMatch[2];
            return `${host}/${path}`;
        }

        // If no match, return null
        return null;
    } catch {
        return null;
    }
}

/**
 * Get a repository identifier from a path
 * First tries to use git remote URL, falls back to path-based identifier
 *
 * @param dirPath Directory path
 * @returns Repository identifier or null
 */
export function getRepositoryIdentifier(dirPath: string): string | null {
    // Try to get git remote URL
    const gitUrl = extractGitRemoteUrl(dirPath);

    if (gitUrl) {
        const identifier = parseGitUrl(gitUrl);
        if (identifier) {
            console.log(`[GIT-UTILS] Repository identified via git remote: ${identifier}`);
            return identifier;
        }
    }

    // If not a git repo or parsing fails, return null
    // The caller will handle the fallback to path-based identification
    return null;
} 