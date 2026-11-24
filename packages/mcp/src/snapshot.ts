import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
    CodebaseSnapshot,
    CodebaseSnapshotV1,
    CodebaseSnapshotV2,
    CodebaseInfo,
    CodebaseIndexOptions,
    CodebaseInfoIndexing,
    CodebaseInfoIndexed,
    CodebaseInfoIndexFailed
} from "./config.js";

/** Whether two snapshot entries hold the same values, in any key order. */
function isSameInfo(a: CodebaseInfo, b: CodebaseInfo): boolean {
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
    return JSON.stringify(a, keys) === JSON.stringify(b, keys);
}

// Delay before retrying a save that could not lock or write the snapshot file,
// doubled after each further failure up to the maximum.
const SAVE_RETRY_MIN_DELAY_MS = 1000;
const SAVE_RETRY_MAX_DELAY_MS = 60_000;

export class SnapshotManager {
    private snapshotFilePath: string;
    private indexedCodebases: string[] = [];
    private indexingCodebases: Map<string, number> = new Map(); // Map of codebase path to progress percentage
    private codebaseFileCount: Map<string, number> = new Map(); // Map of codebase path to indexed file count
    private codebaseInfoMap: Map<string, CodebaseInfo> = new Map(); // Map of codebase path to complete info
    // Codebases this process set or removed and has not settled on disk yet. Every
    // MCP server process shares the snapshot file, so a save writes only these
    // entries and keeps all others as they are on disk, and reading the file never
    // replaces them: a removed codebase stays removed even while the file lists it.
    // A save settles them, except an index this process is running.
    private pendingChanges: Set<string> = new Set();
    // The loader's cleanups among the pending changes (an interrupted index marked
    // failed, a deleted codebase removed), each with the entry it replaces. Another
    // process may save that entry after the load read it, e.g. complete the index, so
    // a cleanup applies only while the file still holds the entry it replaces.
    private loadCleanups: Map<string, CodebaseInfo> = new Map();
    // A save that cannot lock or write the file keeps its changes pending and
    // retries from this timer, which does not keep the process alive.
    private saveRetryTimer: ReturnType<typeof setTimeout> | undefined;
    private saveRetryDelayMs = SAVE_RETRY_MIN_DELAY_MS;

    constructor() {
        // Initialize snapshot file path
        this.snapshotFilePath = path.join(os.homedir(), '.context', 'mcp-codebase-snapshot.json');
    }

    /**
     * Check if snapshot is v2 format
     */
    private isV2Format(snapshot: any): snapshot is CodebaseSnapshotV2 {
        return snapshot && snapshot.formatVersion === 'v2';
    }

    /**
     * Convert v1 format to internal state
     */
    private loadV1Format(snapshot: CodebaseSnapshotV1): void {
        console.log('[SNAPSHOT-DEBUG] Loading v1 format snapshot');

        // Validate that the codebases still exist
        const validCodebases: string[] = [];
        // Removals to save, recorded once the whole snapshot is loaded
        const removedCodebases: string[] = [];
        for (const codebasePath of snapshot.indexedCodebases) {
            if (fs.existsSync(codebasePath)) {
                validCodebases.push(codebasePath);
                console.log(`[SNAPSHOT-DEBUG] Validated codebase: ${codebasePath}`);
            } else {
                console.warn(`[SNAPSHOT-DEBUG] Codebase no longer exists, removing: ${codebasePath}`);
                removedCodebases.push(codebasePath);
            }
        }

        // Handle indexing codebases - treat them as not indexed since they were interrupted
        let indexingCodebasesList: string[] = [];
        if (Array.isArray(snapshot.indexingCodebases)) {
            // Legacy format: string[]
            indexingCodebasesList = snapshot.indexingCodebases;
            console.log(`[SNAPSHOT-DEBUG] Found legacy indexingCodebases array format with ${indexingCodebasesList.length} entries`);
        } else if (snapshot.indexingCodebases && typeof snapshot.indexingCodebases === 'object') {
            // New format: Record<string, number>
            indexingCodebasesList = Object.keys(snapshot.indexingCodebases);
            console.log(`[SNAPSHOT-DEBUG] Found new indexingCodebases object format with ${indexingCodebasesList.length} entries`);
        }

        for (const codebasePath of indexingCodebasesList) {
            if (fs.existsSync(codebasePath)) {
                console.warn(`[SNAPSHOT-DEBUG] Found interrupted indexing codebase: ${codebasePath}. Treating as not indexed.`);
                // Don't add to validIndexingCodebases - treat as not indexed
            } else {
                console.warn(`[SNAPSHOT-DEBUG] Interrupted indexing codebase no longer exists: ${codebasePath}`);
                removedCodebases.push(codebasePath);
            }
        }

        // Restore state - only fully indexed codebases
        this.indexedCodebases = validCodebases;
        this.indexingCodebases = new Map(); // Reset indexing codebases since they were interrupted
        this.codebaseFileCount = new Map(); // No file count info in v1 format

        // Populate codebaseInfoMap for v1 indexed codebases (with minimal info)
        this.codebaseInfoMap = new Map();
        const now = new Date().toISOString();
        for (const codebasePath of validCodebases) {
            const info: CodebaseInfoIndexed = {
                status: 'indexed',
                indexedFiles: 0, // Unknown in v1 format
                totalChunks: 0,  // Unknown in v1 format
                indexStatus: 'completed', // Assume completed for v1 format
                lastUpdated: now
            };
            this.codebaseInfoMap.set(codebasePath, info);
        }
        removedCodebases.forEach(codebasePath => this.pendingChanges.add(codebasePath));
    }

    /**
 * Convert v2 format to internal state
 */
    private loadV2Format(snapshot: CodebaseSnapshotV2): void {
        console.log('[SNAPSHOT-DEBUG] Loading v2 format snapshot');

        const validIndexedCodebases: string[] = [];
        const validIndexingCodebases = new Map<string, number>();
        const validFileCount = new Map<string, number>();
        const validCodebaseInfoMap = new Map<string, CodebaseInfo>();
        // Cleanups to save, with the entry each replaces, recorded once the whole snapshot is loaded
        const cleanups = new Map<string, CodebaseInfo>();

        for (const [codebasePath, info] of Object.entries(snapshot.codebases)) {
            if (!fs.existsSync(codebasePath)) {
                console.warn(`[SNAPSHOT-DEBUG] Codebase no longer exists, removing: ${codebasePath}`);
                cleanups.set(codebasePath, info);
                continue;
            }

            // Store the complete info for this codebase
            validCodebaseInfoMap.set(codebasePath, info);

            if (info.status === 'indexed') {
                validIndexedCodebases.push(codebasePath);
                if ('indexedFiles' in info) {
                    validFileCount.set(codebasePath, info.indexedFiles);
                }
                console.log(`[SNAPSHOT-DEBUG] Validated indexed codebase: ${codebasePath} (${info.indexedFiles || 'unknown'} files, ${info.totalChunks || 'unknown'} chunks)`);
            } else if (info.status === 'indexing') {
                console.warn(`[SNAPSHOT] Found interrupted indexing for '${codebasePath}', resetting to failed`);
                const failedInfo: CodebaseInfoIndexFailed = {
                    status: 'indexfailed',
                    errorMessage: 'Indexing was interrupted (MCP server restarted)',
                    lastAttemptedPercentage: info.indexingPercentage,
                    ...this.getIndexOptions(info),
                    lastUpdated: new Date().toISOString()
                };
                validCodebaseInfoMap.set(codebasePath, failedInfo);
                cleanups.set(codebasePath, info);
            } else if (info.status === 'indexfailed') {
                console.warn(`[SNAPSHOT-DEBUG] Found failed indexing codebase: ${codebasePath}. Error: ${info.errorMessage}`);
                // Failed indexing codebases are not added to indexed or indexing lists
                // But we keep the info for potential retry
            }
        }

        // Restore state
        this.indexedCodebases = validIndexedCodebases;
        this.indexingCodebases = new Map(); // Reset indexing codebases since they were interrupted
        this.codebaseFileCount = validFileCount;
        this.codebaseInfoMap = validCodebaseInfoMap;
        for (const [codebasePath, info] of cleanups) {
            this.pendingChanges.add(codebasePath);
            this.loadCleanups.set(codebasePath, info);
        }
    }

    public getIndexedCodebases(): string[] {
        // Read from JSON file to ensure consistency and persistence
        try {
            if (!fs.existsSync(this.snapshotFilePath)) {
                return [];
            }

            const snapshotData = fs.readFileSync(this.snapshotFilePath, 'utf8');
            const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

            if (this.isV2Format(snapshot)) {
                return Object.entries(snapshot.codebases)
                    .filter(([_, info]) => info.status === 'indexed')
                    .map(([path, _]) => path);
            } else {
                // V1 format
                return snapshot.indexedCodebases || [];
            }
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading indexed codebases from file:`, error);
            // Fallback to memory if file reading fails
            return [...this.indexedCodebases];
        }
    }

    public getIndexingCodebases(): string[] {
        // Read from JSON file to ensure consistency and persistence
        try {
            if (!fs.existsSync(this.snapshotFilePath)) {
                return [];
            }

            const snapshotData = fs.readFileSync(this.snapshotFilePath, 'utf8');
            const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

            if (this.isV2Format(snapshot)) {
                return Object.entries(snapshot.codebases)
                    .filter(([_, info]) => info.status === 'indexing')
                    .map(([path, _]) => path);
            } else {
                // V1 format - Handle both legacy array format and new object format
                if (Array.isArray(snapshot.indexingCodebases)) {
                    // Legacy format: return the array directly
                    return snapshot.indexingCodebases;
                } else if (snapshot.indexingCodebases && typeof snapshot.indexingCodebases === 'object') {
                    // New format: return the keys of the object
                    return Object.keys(snapshot.indexingCodebases);
                }
            }

            return [];
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading indexing codebases from file:`, error);
            // Fallback to memory if file reading fails
            return Array.from(this.indexingCodebases.keys());
        }
    }

    private isSameOrDescendantPath(candidatePath: string, codebasePath: string): boolean {
        const relativePath = path.relative(path.resolve(codebasePath), path.resolve(candidatePath));
        return relativePath === ''
            || (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath));
    }

    private findBestMatchingCodebasePath(codebasePath: string, candidates: string[]): string | undefined {
        let bestMatch: string | undefined;
        let bestMatchLength = -1;

        for (const candidate of candidates) {
            const resolvedCandidate = path.resolve(candidate);
            if (!this.isSameOrDescendantPath(codebasePath, resolvedCandidate)) continue;

            if (resolvedCandidate.length > bestMatchLength) {
                bestMatch = candidate;
                bestMatchLength = resolvedCandidate.length;
            }
        }

        return bestMatch;
    }

    private getIndexOptions(options?: CodebaseIndexOptions): CodebaseIndexOptions {
        const indexOptions: CodebaseIndexOptions = {};
        if (options?.requestSplitter === 'ast' || options?.requestSplitter === 'langchain') {
            indexOptions.requestSplitter = options.requestSplitter;
        }
        if (options?.requestCustomExtensions?.length) {
            indexOptions.requestCustomExtensions = options.requestCustomExtensions;
        }
        if (options?.requestIgnorePatterns?.length) {
            indexOptions.requestIgnorePatterns = options.requestIgnorePatterns;
        }
        return indexOptions;
    }

    private resolveIndexOptions(codebasePath: string, options?: CodebaseIndexOptions): CodebaseIndexOptions {
        return this.getIndexOptions(options ?? this.codebaseInfoMap.get(codebasePath));
    }

    public findIndexedCodebasePath(codebasePath: string): string | undefined {
        return this.findBestMatchingCodebasePath(codebasePath, this.getIndexedCodebases());
    }

    public findIndexingCodebasePath(codebasePath: string): string | undefined {
        return this.findBestMatchingCodebasePath(codebasePath, this.getIndexingCodebases());
    }

    public findTrackedCodebasePath(codebasePath: string): string | undefined {
        this.refreshFromDisk();
        return this.findBestMatchingCodebasePath(codebasePath, Array.from(this.codebaseInfoMap.keys()));
    }

    /**
     * @deprecated Use getCodebaseInfo() for individual codebases or iterate through codebases for v2 format support
     */
    public getIndexingCodebasesWithProgress(): Map<string, number> {
        return new Map(this.indexingCodebases);
    }

    public getIndexingProgress(codebasePath: string): number | undefined {
        // Read from JSON file to ensure consistency and persistence
        try {
            if (!fs.existsSync(this.snapshotFilePath)) {
                return undefined;
            }

            const snapshotData = fs.readFileSync(this.snapshotFilePath, 'utf8');
            const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

            if (this.isV2Format(snapshot)) {
                const info = snapshot.codebases[codebasePath];
                if (info && info.status === 'indexing') {
                    return info.indexingPercentage || 0;
                }
                return undefined;
            } else {
                // V1 format - Handle both legacy array format and new object format
                if (Array.isArray(snapshot.indexingCodebases)) {
                    // Legacy format: if path exists in array, assume 0% progress
                    return snapshot.indexingCodebases.includes(codebasePath) ? 0 : undefined;
                } else if (snapshot.indexingCodebases && typeof snapshot.indexingCodebases === 'object') {
                    // New format: return the actual progress percentage
                    return snapshot.indexingCodebases[codebasePath];
                }
            }

            return undefined;
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading progress from file for ${codebasePath}:`, error);
            // Fallback to memory if file reading fails
            return this.indexingCodebases.get(codebasePath);
        }
    }

    /**
     * @deprecated Use setCodebaseIndexing() instead for v2 format support
     */
    public addIndexingCodebase(codebasePath: string, progress: number = 0): void {
        this.indexingCodebases.set(codebasePath, progress);

        // Also update codebaseInfoMap for v2 compatibility
        const info: CodebaseInfoIndexing = {
            status: 'indexing',
            indexingPercentage: progress,
            lastUpdated: new Date().toISOString()
        };
        this.setInfo(codebasePath, info);
    }

    /**
     * @deprecated Use setCodebaseIndexing() instead for v2 format support
     */
    public updateIndexingProgress(codebasePath: string, progress: number): void {
        if (this.indexingCodebases.has(codebasePath)) {
            this.indexingCodebases.set(codebasePath, progress);

            // Also update codebaseInfoMap for v2 compatibility
            const info: CodebaseInfoIndexing = {
                status: 'indexing',
                indexingPercentage: progress,
                lastUpdated: new Date().toISOString()
            };
            this.setInfo(codebasePath, info);
        }
    }

    /**
     * @deprecated Use removeCodebaseCompletely() or state-specific methods instead for v2 format support
     */
    public removeIndexingCodebase(codebasePath: string): void {
        this.indexingCodebases.delete(codebasePath);
        // Also remove from codebaseInfoMap for v2 compatibility
        this.deleteInfo(codebasePath);
    }

    /**
     * @deprecated Use setCodebaseIndexed() instead for v2 format support
     */
    public addIndexedCodebase(codebasePath: string, fileCount?: number): void {
        if (!this.indexedCodebases.includes(codebasePath)) {
            this.indexedCodebases.push(codebasePath);
        }
        if (fileCount !== undefined) {
            this.codebaseFileCount.set(codebasePath, fileCount);
        }

        // Also update codebaseInfoMap for v2 compatibility
        const info: CodebaseInfoIndexed = {
            status: 'indexed',
            indexedFiles: fileCount || 0,
            totalChunks: 0, // Unknown in v1 method
            indexStatus: 'completed',
            lastUpdated: new Date().toISOString()
        };
        this.setInfo(codebasePath, info);
    }

    /**
     * @deprecated Use removeCodebaseCompletely() or state-specific methods instead for v2 format support
     */
    public removeIndexedCodebase(codebasePath: string): void {
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.codebaseFileCount.delete(codebasePath);
        // Also remove from codebaseInfoMap for v2 compatibility
        this.deleteInfo(codebasePath);
    }

    /**
     * @deprecated Use setCodebaseIndexed() instead for v2 format support
     */
    public moveFromIndexingToIndexed(codebasePath: string, fileCount?: number): void {
        this.removeIndexingCodebase(codebasePath);
        this.addIndexedCodebase(codebasePath, fileCount);
    }

    /**
     * @deprecated Use getCodebaseInfo() and check indexedFiles property instead for v2 format support
     */
    public getIndexedFileCount(codebasePath: string): number | undefined {
        return this.codebaseFileCount.get(codebasePath);
    }

    /**
     * @deprecated Use setCodebaseIndexed() with complete stats instead for v2 format support
     */
    public setIndexedFileCount(codebasePath: string, fileCount: number): void {
        this.codebaseFileCount.set(codebasePath, fileCount);
    }

    /**
     * Set codebase to indexing status
     */
    public setCodebaseIndexing(codebasePath: string, progress: number = 0, indexOptions?: CodebaseIndexOptions): void {
        this.indexingCodebases.set(codebasePath, progress);

        // Remove from other states
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.codebaseFileCount.delete(codebasePath);

        const resolvedIndexOptions = this.resolveIndexOptions(codebasePath, indexOptions);

        // Update info map
        const info: CodebaseInfoIndexing = {
            status: 'indexing',
            indexingPercentage: progress,
            ...resolvedIndexOptions,
            lastUpdated: new Date().toISOString()
        };
        this.setInfo(codebasePath, info);
    }

    /**
     * Set codebase to indexed status with complete statistics
     */
    public setCodebaseIndexed(
        codebasePath: string,
        stats: { indexedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached' },
        indexOptions?: CodebaseIndexOptions
    ): void {
        // Defensive guard: 0/0 + completed is a known-bad state that causes an
        // infinite force-reindex loop — the client reads it as "not indexed",
        // triggers force=true, deletes real data, and rewrites 0/0. Refuse to
        // persist this combination regardless of who called us. See Issue #295.
        if (stats.indexedFiles === 0 && stats.totalChunks === 0 && stats.status === 'completed') {
            console.error(`[SNAPSHOT] Refusing to write 0/0+completed for '${codebasePath}' — invalid state. Stack trace:`);
            console.trace();
            return;
        }

        // Add to indexed list if not already there
        if (!this.indexedCodebases.includes(codebasePath)) {
            this.indexedCodebases.push(codebasePath);
        }

        // Remove from indexing state
        this.indexingCodebases.delete(codebasePath);

        // Update file count and info
        this.codebaseFileCount.set(codebasePath, stats.indexedFiles);

        const resolvedIndexOptions = this.resolveIndexOptions(codebasePath, indexOptions);

        const info: CodebaseInfoIndexed = {
            status: 'indexed',
            indexedFiles: stats.indexedFiles,
            totalChunks: stats.totalChunks,
            indexStatus: stats.status,
            ...resolvedIndexOptions,
            lastUpdated: new Date().toISOString()
        };
        this.setInfo(codebasePath, info);
    }

    /**
     * Refresh the stats of an indexed codebase after an incremental sync.
     * Memory takes the new stats at once. On disk, only this entry is patched,
     * under the snapshot lock, and only while no other process has replaced it
     * since `expected` was read: it must still be indexed and not be newer than
     * `expected`. The stats are not left to saveCodebaseSnapshot(), which writes
     * pending changes without that check, so this cannot undo another process's
     * clear or re-index; stats that are not written give way to the file at its
     * next read. A change to the entry that was already pending stays pending,
     * and the next save writes it with the new stats.
     * @returns Whether the entry on disk was updated
     */
    public updateIndexedStats(
        codebasePath: string,
        expected: CodebaseInfoIndexed,
        stats: { indexedFiles: number; totalChunks: number }
    ): boolean {
        const wasPending = this.pendingChanges.has(codebasePath);
        this.setCodebaseIndexed(codebasePath, { ...stats, status: expected.indexStatus });
        if (!wasPending) {
            this.pendingChanges.delete(codebasePath);
        }
        const updated = this.codebaseInfoMap.get(codebasePath);
        if (updated === expected || updated?.status !== 'indexed') {
            return false; // setCodebaseIndexed() refused the stats
        }

        if (!this.acquireLock()) {
            console.warn(`[SNAPSHOT-DEBUG] Failed to acquire lock, not writing the stats of '${codebasePath}' to disk`);
            return false;
        }

        try {
            const diskSnapshot: CodebaseSnapshot = JSON.parse(fs.readFileSync(this.snapshotFilePath, 'utf8'));
            if (!this.isV2Format(diskSnapshot)) {
                return false;
            }

            // A clear, re-index or refresh by another process since `expected` was
            // read removes the entry or gives it a later timestamp. NaN fails too.
            const diskInfo = diskSnapshot.codebases[codebasePath];
            if (diskInfo?.status !== 'indexed'
                || !(Date.parse(diskInfo.lastUpdated) <= Date.parse(expected.lastUpdated))) {
                console.log(`[SNAPSHOT-DEBUG] '${codebasePath}' changed on disk during the sync, not writing its stats`);
                return false;
            }

            diskSnapshot.codebases[codebasePath] = {
                ...diskInfo,
                indexedFiles: updated.indexedFiles,
                totalChunks: updated.totalChunks,
                lastUpdated: updated.lastUpdated
            };
            diskSnapshot.lastUpdated = new Date().toISOString();
            fs.writeFileSync(this.snapshotFilePath, JSON.stringify(diskSnapshot, null, 2));
            return true;
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Failed to write the stats of '${codebasePath}' to disk:`, error);
            return false;
        } finally {
            this.releaseLock();
        }
    }

    /**
     * Set codebase to failed status
     */
    public setCodebaseIndexFailed(
        codebasePath: string,
        errorMessage: string,
        lastAttemptedPercentage?: number,
        indexOptions?: CodebaseIndexOptions
    ): void {
        // Remove from other states
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.indexingCodebases.delete(codebasePath);
        this.codebaseFileCount.delete(codebasePath);

        const resolvedIndexOptions = this.resolveIndexOptions(codebasePath, indexOptions);

        // Update info map
        const info: CodebaseInfoIndexFailed = {
            status: 'indexfailed',
            errorMessage: errorMessage,
            lastAttemptedPercentage: lastAttemptedPercentage,
            ...resolvedIndexOptions,
            lastUpdated: new Date().toISOString()
        };
        this.setInfo(codebasePath, info);
    }

    /**
     * Get codebase status
     */
    public getCodebaseStatus(codebasePath: string): 'indexed' | 'indexing' | 'indexfailed' | 'not_found' {
        const info = this.getCodebaseInfo(codebasePath);
        if (!info) return 'not_found';
        return info.status;
    }

    /**
     * Get complete codebase information, including changes other MCP processes
     * saved. The object stays the same while the entry does not change.
     */
    public getCodebaseInfo(codebasePath: string): CodebaseInfo | undefined {
        this.refreshFromDisk();
        return this.codebaseInfoMap.get(codebasePath);
    }

    /**
     * Get all failed codebases
     */
    public getFailedCodebases(): string[] {
        this.refreshFromDisk();
        return Array.from(this.codebaseInfoMap.entries())
            .filter(([_, info]) => info.status === 'indexfailed')
            .map(([path, _]) => path);
    }

    /**
     * Completely remove a codebase from all tracking (for clear_index operation)
     */
    public removeCodebaseCompletely(codebasePath: string): void {
        // Remove from all internal state
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.indexingCodebases.delete(codebasePath);
        this.codebaseFileCount.delete(codebasePath);
        // Recorded as a change, so reading the file does not bring it back before the save
        this.deleteInfo(codebasePath);

        console.log(`[SNAPSHOT-DEBUG] Completely removed codebase from snapshot: ${codebasePath}`);
    }

    public loadCodebaseSnapshot(): void {
        console.log('[SNAPSHOT-DEBUG] Loading codebase snapshot from:', this.snapshotFilePath);

        try {
            if (!fs.existsSync(this.snapshotFilePath)) {
                console.log('[SNAPSHOT-DEBUG] Snapshot file does not exist. Starting with empty codebase list.');
                return;
            }

            const snapshotData = fs.readFileSync(this.snapshotFilePath, 'utf8');
            const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

            console.log('[SNAPSHOT-DEBUG] Loaded snapshot:', snapshot);

            if (this.isV2Format(snapshot)) {
                this.loadV2Format(snapshot);
            } else {
                this.loadV1Format(snapshot);
            }

            // Always save in v2 format after loading (migration). The read above is not
            // locked, so another process may save first; the save then keeps its entries
            // over the cleanups above (see loadCleanups).
            this.saveCodebaseSnapshot();

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error loading snapshot:', error);
            console.log('[SNAPSHOT-DEBUG] Starting with empty codebase list due to snapshot error.');
        }
    }

    private acquireLock(maxRetries = 5, retryInterval = 100): boolean {
        const lockPath = this.snapshotFilePath + '.lock';
        try {
            // The lock sits next to the snapshot file, whose directory a new home lacks
            fs.mkdirSync(path.dirname(this.snapshotFilePath), { recursive: true });
        } catch { /* taking the lock below fails then */ }
        for (let i = 0; i < maxRetries; i++) {
            try {
                fs.mkdirSync(lockPath);
                return true;
            } catch {
                // Check for stale lock (> 10 seconds old)
                try {
                    const stat = fs.statSync(lockPath);
                    if (Date.now() - stat.mtimeMs > 10000) {
                        fs.rmdirSync(lockPath);
                        continue; // retry after removing stale lock
                    }
                } catch { /* lock was removed by another process */ }
                // Busy wait and retry
                const waitUntil = Date.now() + retryInterval;
                while (Date.now() < waitUntil) { /* busy wait */ }
            }
        }
        return false;
    }

    private releaseLock(): void {
        try {
            fs.rmdirSync(this.snapshotFilePath + '.lock');
        } catch { /* already released */ }
    }

    /** Set an entry as a change of this process, for the next save to write. */
    private setInfo(codebasePath: string, info: CodebaseInfo): void {
        this.codebaseInfoMap.set(codebasePath, info);
        this.pendingChanges.add(codebasePath);
        this.loadCleanups.delete(codebasePath);
    }

    /** Remove an entry as a change of this process, for the next save to write. */
    private deleteInfo(codebasePath: string): void {
        this.codebaseInfoMap.delete(codebasePath);
        this.pendingChanges.add(codebasePath);
        this.loadCleanups.delete(codebasePath);
    }

    /**
     * Read the entries of the snapshot file: none when there is no file, and
     * undefined when it cannot be read or is not in v2 format.
     */
    private readDiskEntries(): Record<string, CodebaseInfo> | undefined {
        try {
            if (!fs.existsSync(this.snapshotFilePath)) {
                return {};
            }
            const snapshot = JSON.parse(fs.readFileSync(this.snapshotFilePath, 'utf8'));
            if (this.isV2Format(snapshot) && snapshot.codebases && typeof snapshot.codebases === 'object') {
                return snapshot.codebases;
            }
        } catch (error) {
            console.warn('[SNAPSHOT-DEBUG] Error reading the snapshot file:', error);
        }
        return undefined;
    }

    /**
     * Pick up what other MCP processes saved. Keeps the current state when the
     * file cannot be read, e.g. while another process is writing it.
     */
    private refreshFromDisk(): void {
        const diskEntries = this.readDiskEntries();
        if (diskEntries) {
            this.adoptDiskEntries(diskEntries);
        }
    }

    /**
     * Drop the loader's cleanups of entries that another process saved since the
     * load read them: its entry is newer, e.g. an index it completed or resumed.
     */
    private dropOutdatedCleanups(diskEntries: Record<string, CodebaseInfo>): void {
        for (const [codebasePath, loadedInfo] of this.loadCleanups) {
            const diskInfo = diskEntries[codebasePath];
            if (!diskInfo || typeof diskInfo !== 'object' || !isSameInfo(diskInfo, loadedInfo)) {
                this.loadCleanups.delete(codebasePath);
                this.pendingChanges.delete(codebasePath);
            }
        }
    }

    /**
     * Take every entry from the snapshot file except this process's pending
     * changes. An entry whose values did not change keeps its object, since
     * callers compare these objects to detect state changes. Malformed entries
     * are ignored.
     */
    private adoptDiskEntries(diskEntries: Record<string, CodebaseInfo>): void {
        this.dropOutdatedCleanups(diskEntries);
        const entries = new Map(Object.entries(diskEntries)
            .filter(([, info]) => info !== null && typeof info === 'object'));
        for (const codebasePath of Array.from(this.codebaseInfoMap.keys())) {
            if (!entries.has(codebasePath) && !this.pendingChanges.has(codebasePath)) {
                this.codebaseInfoMap.delete(codebasePath);
                this.updateDerivedState(codebasePath, undefined);
            }
        }
        for (const [codebasePath, diskInfo] of entries) {
            const info = this.codebaseInfoMap.get(codebasePath);
            if (this.pendingChanges.has(codebasePath) || (info && isSameInfo(info, diskInfo))) {
                continue;
            }
            this.codebaseInfoMap.set(codebasePath, diskInfo);
            this.updateDerivedState(codebasePath, diskInfo);
        }
    }

    /** Keep the indexed, indexing and file count lists in line with an entry taken from disk. */
    private updateDerivedState(codebasePath: string, info: CodebaseInfo | undefined): void {
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.indexingCodebases.delete(codebasePath);
        this.codebaseFileCount.delete(codebasePath);
        if (info?.status === 'indexed') {
            this.indexedCodebases.push(codebasePath);
            if (info.indexedFiles !== undefined) {
                this.codebaseFileCount.set(codebasePath, info.indexedFiles);
            }
        } else if (info?.status === 'indexing') {
            this.indexingCodebases.set(codebasePath, info.indexingPercentage || 0);
        }
        // indexfailed entries only need codebaseInfoMap, no extra list
    }

    public saveCodebaseSnapshot(): void {
        console.log('[SNAPSHOT-DEBUG] Saving codebase snapshot to:', this.snapshotFilePath);

        // Never write without the lock: another process could save between this
        // save's read and its write, and one of the two would lose its changes.
        // They stay pending instead, for a retry or the next save to write.
        if (!this.acquireLock()) {
            console.warn('[SNAPSHOT-DEBUG] Failed to acquire lock, keeping the changes for a later save');
            this.scheduleSaveRetry();
            return;
        }

        try {
            // Other MCP processes save to this file too. Write only this process's
            // pending changes and keep all other entries as they are on disk, so an
            // entry this process loaded and did not touch never reverts another
            // process's clear or re-index. A file that cannot be read, or is still in
            // v1 format, is replaced with this process's state.
            const diskEntries = this.readDiskEntries();
            let codebases: Record<string, CodebaseInfo>;
            if (diskEntries) {
                this.dropOutdatedCleanups(diskEntries);
                codebases = diskEntries;
                for (const codebasePath of this.pendingChanges) {
                    const info = this.codebaseInfoMap.get(codebasePath);
                    if (info) {
                        codebases[codebasePath] = info;
                    } else {
                        delete codebases[codebasePath];
                    }
                }
            } else {
                codebases = Object.fromEntries(this.codebaseInfoMap);
            }

            const snapshot: CodebaseSnapshotV2 = {
                formatVersion: 'v2',
                codebases: codebases,
                lastUpdated: new Date().toISOString()
            };

            fs.writeFileSync(this.snapshotFilePath, JSON.stringify(snapshot, null, 2));
            this.cancelSaveRetry();

            // The changes are on disk now. An index this process runs stays pending
            // until it ends: reading the file never replaces its progress, and every
            // save writes it back, e.g. after a starting process marked it interrupted.
            this.loadCleanups.clear();
            for (const codebasePath of this.pendingChanges) {
                if (this.codebaseInfoMap.get(codebasePath)?.status !== 'indexing') {
                    this.pendingChanges.delete(codebasePath);
                }
            }
            // Take on what other processes saved meanwhile.
            this.adoptDiskEntries(codebases);

            const indexedCount = this.indexedCodebases.length;
            const indexingCount = this.indexingCodebases.size;
            const failedCount = Array.from(this.codebaseInfoMap.values())
                .filter(info => info.status === 'indexfailed').length;

            console.log(`[SNAPSHOT-DEBUG] Snapshot saved successfully in v2 format. Indexed: ${indexedCount}, Indexing: ${indexingCount}, Failed: ${failedCount}`);

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error saving snapshot:', error);
            this.scheduleSaveRetry();
        } finally {
            this.releaseLock();
        }
    }

    /**
     * Save now if an earlier save failed and its retry is still waiting, e.g.
     * before the process exits, since the retry timer does not keep the process
     * alive. Does nothing otherwise.
     */
    public flushDeferredSave(): void {
        if (this.saveRetryTimer) {
            this.saveCodebaseSnapshot();
        }
    }

    /** Retry a failed save later, waiting longer while saves keep failing. */
    private scheduleSaveRetry(): void {
        if (this.saveRetryTimer) {
            return;
        }
        const delay = this.saveRetryDelayMs;
        this.saveRetryDelayMs = Math.min(delay * 2, SAVE_RETRY_MAX_DELAY_MS);
        this.saveRetryTimer = setTimeout(() => {
            this.saveRetryTimer = undefined;
            this.saveCodebaseSnapshot();
        }, delay);
        this.saveRetryTimer.unref();
    }

    /** A save went through, so no retry is needed. */
    private cancelSaveRetry(): void {
        clearTimeout(this.saveRetryTimer);
        this.saveRetryTimer = undefined;
        this.saveRetryDelayMs = SAVE_RETRY_MIN_DELAY_MS;
    }
}
