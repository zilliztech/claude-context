/**
 * workspaceState keys shared across the extension.
 * Centralized so the provider (writer) and SyncCommand (reader) stay in sync.
 */
export const STATE_INDEXED_PATHS = 'semanticCodeSearch.indexedPaths';
export const STATE_FOLDER_INPUT = 'semanticCodeSearch.folderInput';
export const STATE_EXCLUDE_INPUT = 'semanticCodeSearch.excludeInput';
