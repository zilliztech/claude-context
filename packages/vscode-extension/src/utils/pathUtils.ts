import * as path from 'path';
import { SemanticSearchResult } from '@zilliz/claude-context-core';

/** A search result tagged with the folder (codebasePath) it came from. */
export interface TaggedResult extends SemanticSearchResult {
    /** The indexed folder (absolute codebasePath) this result was found in. */
    searchFolder: string;
    /** Absolute path to the file on disk. */
    absolutePath: string;
}

/** Split a comma/newline separated string into a trimmed, de-duplicated, non-empty list. */
export function parseListInput(raw: string): string[] {
    if (!raw) {
        return [];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(/[\n,]/)) {
        const trimmed = part.trim();
        if (trimmed.length > 0 && !seen.has(trimmed)) {
            seen.add(trimmed);
            out.push(trimmed);
        }
    }
    return out;
}

/**
 * Resolve folder-input entries to absolute paths inside the workspace root.
 * Empty input falls back to [workspaceRoot]. Entries that escape the root are
 * reported as errors and excluded from `resolved`.
 */
export function resolveIndexFolders(
    raw: string,
    workspaceRoot: string
): { resolved: string[]; errors: string[] } {
    const root = path.resolve(workspaceRoot);
    const entries = parseListInput(raw);
    if (entries.length === 0) {
        return { resolved: [root], errors: [] };
    }

    const resolved: string[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
        const abs = path.isAbsolute(entry) ? path.resolve(entry) : path.resolve(root, entry);
        const rel = path.relative(root, abs);
        const escapes = rel.startsWith('..') || path.isAbsolute(rel);
        if (escapes) {
            errors.push(`Folder is outside the workspace: ${entry}`);
            continue;
        }
        if (!seen.has(abs)) {
            seen.add(abs);
            resolved.push(abs);
        }
    }

    return { resolved, errors };
}

/** Flatten per-folder result arrays, sort by score descending, take top `limit`. */
export function mergeAndSortResults(perFolder: TaggedResult[][], limit: number): TaggedResult[] {
    const all: TaggedResult[] = [];
    for (const group of perFolder) {
        all.push(...group);
    }
    all.sort((a, b) => b.score - a.score);
    return all.slice(0, limit);
}
