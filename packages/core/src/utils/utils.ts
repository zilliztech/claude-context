import * as fs from "fs";
import * as path from "path";

/**
 * Get the Git repository name from a folder path by looking for the .git directory
 * and reading the remote origin URL from the git config
 * @param folderPath Path to folder to check
 * @returns Repository name or null if not a git repo
 */
export function getGitRepoName(folderPath: string): { gitRoot: string; repoName: string } {
    try {
        // Walk up directory tree looking for .git folder
        let currentPath = folderPath;
        let gitDir = null;
        let gitRoot = '';

        while (currentPath !== path.parse(currentPath).root) {
            const potentialGitDir = path.join(currentPath, '.git');
            if (fs.existsSync(potentialGitDir)) {
                gitDir = potentialGitDir;
                gitRoot = currentPath;
                break;
            }
            currentPath = path.dirname(currentPath);
        }

        if (!gitDir) {
            return { gitRoot: '', repoName: '' };
        }

        // Read config file to get remote origin URL
        const configPath = path.join(gitDir, 'config');
        const config = fs.readFileSync(configPath, 'utf8');

        // Extract remote origin URL using regex
        const originUrlMatch = config.match(/\[remote "origin"\][\s\S]*?url = (.+)/);
        if (!originUrlMatch) {
            return { gitRoot: gitRoot, repoName: '' };
        }

        const originUrl = originUrlMatch[1].trim();

        // Extract repo name from URL
        const repoNameMatch = originUrl.match(/\/([^\/]+?)(\.git)?$/);
        if (!repoNameMatch) {
            return { gitRoot: gitRoot, repoName: '' };
        }

        return { gitRoot: gitRoot, repoName: repoNameMatch[1] };

    } catch (error) {
        console.error('Error getting git repo name:', error);
        return { gitRoot: '', repoName: '' };
    }
}

export async function checkServerSnapshot(codeAgentEndpoint: string, codebasePath: string): Promise<{ json: any; error: boolean; version: string }> {
    try {
        console.log(`[SERVER-CHECK] 🔍 Checking server snapshot for codebase: ${codebasePath}`);
        const response = await fetch(`${codeAgentEndpoint}/get_snapshot?codebase=${codebasePath}`);

        if (!response.ok) {
            console.error(`[SERVER-CHECK] ❌ Server request failed with status: ${response.status}`);
            return {
                json: { error: `Failed to connect to server (status: ${response.status}). Please ensure the server is running.` },
                error: true,
                version: ""
            };
        }

        const serverData = await response.json() as any;

        if (serverData.error !== "success") {
            console.error(`[SERVER-CHECK] ❌ Code is not onboarded at server side: ${serverData.error}`);
            return {
                json: { error: "Code is not onboarded at server side" },
                error: true,
                version: ""
            };
        }

        console.log(`[SERVER-CHECK] ✅ Server snapshot check passed for codebase: ${codebasePath}`);
        return {
            json: serverData.data,
            version: serverData.version,
            error: false,
        };
    } catch (serverError: any) {
        console.error(`[SERVER-CHECK] ❌ Error checking server snapshot:`, serverError.message || serverError);
        return {
            json: { error: `Failed to check server snapshot: ${serverError.message || serverError}. Please ensure the server is running.` },
            error: true,
            version: ""
        };
    }
}

export function simpleGlobMatch(text: string, pattern: string): boolean {
    if (!text || !pattern) return false;

    // Convert glob pattern to regex
    const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
        .replace(/\*/g, '.*'); // Convert * to .*

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
}


export function isPatternMatch(filePath: string, pattern: string): boolean {
    // Handle directory patterns (ending with /)
    if (pattern.endsWith('/')) {
        const dirPattern = pattern.slice(0, -1);
        const pathParts = filePath.split('/');
        return pathParts.some(part => simpleGlobMatch(part, dirPattern));
    }

    // Handle file patterns
    if (pattern.includes('/')) {
        // Pattern with path separator - match exact path
        return simpleGlobMatch(filePath, pattern);
    } else {
        // Pattern without path separator - match filename in any directory
        const fileName = path.basename(filePath);
        return simpleGlobMatch(fileName, pattern);
    }
}

export function matchesIgnorePattern(filePath: string, basePath: string, ignorePatterns: string[] = []): boolean {
    if (ignorePatterns.length === 0) {
        return false;
    }

    const relativePath = path.relative(basePath, filePath);
    const normalizedPath = relativePath.replace(/\\/g, '/'); // Normalize path separators

    for (const pattern of ignorePatterns) {
        if (isPatternMatch(normalizedPath, pattern)) {
            return true;
        }
    }

    return false;
}