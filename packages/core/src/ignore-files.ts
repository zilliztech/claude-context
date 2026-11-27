/**
 * Which `.*ignore` files in a codebase root are allowed to shape the search index.
 *
 * Every `.*ignore` file in the root used to be globbed in, which lets a build-tool
 * filter that has nothing to do with code search erase the whole corpus: a
 * one-line `.dockerignore` containing `*` filters out every file and indexing
 * reports "Found 0 code files". Only ignore files that describe "source a human
 * would not want to read" belong here.
 *
 * Opt a skipped file back in with CUSTOM_IGNORE_FILES=".dockerignore,.npmignore".
 */
export const INDEX_IGNORE_FILENAMES: readonly string[] = [
    '.gitignore',
    '.contextignore',
    '.cursorignore',
    '.codeiumignore',
];

/**
 * Parse the CUSTOM_IGNORE_FILES opt-in list.
 * Accepts names with or without the leading dot; empty entries are dropped.
 */
export function parseExtraIgnoreFiles(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length > 0)
        .map(name => (name.startsWith('.') ? name : `.${name}`));
}

export interface IgnoreFileSelection {
    /** Ignore files that will be loaded, in allowlist-then-extras order. */
    selected: string[];
    /** `.*ignore` files present in the root that were deliberately not loaded. */
    skipped: string[];
}

/**
 * Split the directory entries of a codebase root into ignore files we honor and
 * `.*ignore` files we deliberately skip. Pure — takes entry names, not paths.
 */
export function selectIgnoreFiles(entryNames: string[], extraNames: string[] = []): IgnoreFileSelection {
    const allowed = [...INDEX_IGNORE_FILENAMES, ...extraNames];
    const present = new Set(entryNames);

    const selected: string[] = [];
    for (const name of allowed) {
        if (present.has(name) && !selected.includes(name)) {
            selected.push(name);
        }
    }

    const skipped = entryNames.filter(
        name => name.startsWith('.') && name.endsWith('ignore') && !selected.includes(name)
    );

    return { selected, skipped };
}
