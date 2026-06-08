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

export class SnapshotManager {
    private snapshotFilePath: string;
    private indexedCodebases: string[] = [];
    private indexingCodebases: Map<string, number> = new Map(); // canonical key → progress %
    private codebaseFileCount: Map<string, number> = new Map(); // canonical key → file count
    private codebaseInfoMap: Map<string, CodebaseInfo> = new Map(); // canonical key → info
    private recentlyRemoved: Set<string> = new Set(); // canonical keys removed since last save
    /** Injected by ToolHandlers after Context is ready. */
    private getCanonicalKeyFn: (localPath: string) => string = (p) => path.resolve(p);

    constructor() {
        // Initialize snapshot file path
        this.snapshotFilePath = path.join(os.homedir(), '.context', 'mcp-codebase-snapshot.json');
    }

    /**
     * Wire up the canonical-key resolver from Context.  Must be called once
     * before any snapshot operations that accept local paths.
     */
    public setCanonicalKeyFn(fn: (localPath: string) => string): void {
        this.getCanonicalKeyFn = fn;
    }

    /**
     * Return the canonical key for a local path (git remote URL or absolute path).
     */
    public canonicalKey(localPath: string): string {
        return this.getCanonicalKeyFn(path.resolve(localPath));
    }

    /**
     * Return the local absolute path stored for a canonical key, or undefined
     * when the key is already an absolute path (non-git codebases).
     */
    public getLocalPath(canonicalKey: string): string | undefined {
        const info = this.codebaseInfoMap.get(canonicalKey);
        return info?.localPath;
    }

    /**
     * True when the snapshot key holds a POSIX local path ("/foo" or "~/foo")
     * rather than a canonical git-remote URL.  Used both to detect legacy
     * pre-migration keys and to identify non-git codebases (whose canonical
     * key is the absolute path itself).
     */
    private isLocalPathKey(key: string): boolean {
        return key.startsWith('/') || key.startsWith('~');
    }

    /**
     * Resolve a "raw key" snapshot entry (legacy local path or already-canonical
     * key) to canonical form, preserving the on-disk local path on `info` so the
     * calling machine can recover its real filesystem location.
     */
    private migrateEntryToCanonical(rawKey: string, info: CodebaseInfo): {
        canonKey: string;
        localPath: string | undefined;
        info: CodebaseInfo;
    } {
        const isLocal = this.isLocalPathKey(rawKey);
        const localPath = isLocal ? rawKey : info.localPath;
        const canonKey = isLocal ? this.canonicalKey(rawKey) : rawKey;
        const patchedInfo: CodebaseInfo = localPath ? { ...info, localPath } : info;
        return { canonKey, localPath, info: patchedInfo };
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
        for (const codebasePath of snapshot.indexedCodebases) {
            if (fs.existsSync(codebasePath)) {
                validCodebases.push(codebasePath);
                console.log(`[SNAPSHOT-DEBUG] Validated codebase: ${codebasePath}`);
            } else {
                console.warn(`[SNAPSHOT-DEBUG] Codebase no longer exists, removing: ${codebasePath}`);
                this.recentlyRemoved.add(this.canonicalKey(codebasePath));
            }
        }

        // Handle indexing codebases - treat them as not indexed since they were interrupted
        let indexingCodebasesList: string[] = [];
        if (Array.isArray(snapshot.indexingCodebases)) {
            indexingCodebasesList = snapshot.indexingCodebases;
            console.log(`[SNAPSHOT-DEBUG] Found legacy indexingCodebases array format with ${indexingCodebasesList.length} entries`);
        } else if (snapshot.indexingCodebases && typeof snapshot.indexingCodebases === 'object') {
            indexingCodebasesList = Object.keys(snapshot.indexingCodebases);
            console.log(`[SNAPSHOT-DEBUG] Found new indexingCodebases object format with ${indexingCodebasesList.length} entries`);
        }

        for (const codebasePath of indexingCodebasesList) {
            if (!fs.existsSync(codebasePath)) {
                this.recentlyRemoved.add(this.canonicalKey(codebasePath));
            }
        }

        // Restore state - keyed by canonical key
        this.indexedCodebases = [];
        this.indexingCodebases = new Map();
        this.codebaseFileCount = new Map();
        this.codebaseInfoMap = new Map();
        const now = new Date().toISOString();
        for (const codebasePath of validCodebases) {
            const key = this.canonicalKey(codebasePath);
            this.indexedCodebases.push(key);
            const info: CodebaseInfoIndexed = {
                status: 'indexed',
                indexedFiles: 0,
                totalChunks: 0,
                indexStatus: 'completed',
                localPath: codebasePath,
                lastUpdated: now
            };
            this.codebaseInfoMap.set(key, info);
        }
    }

    /**
     * Convert v2 format to internal state.
     *
     * Handles two sub-variants:
     *  - Legacy: snapshot keys are local absolute paths (start with "/")
     *  - Current: snapshot keys are canonical keys (git remote URL or absolute path)
     *
     * Legacy entries are migrated on load: the key is re-mapped to the canonical
     * key and the old absolute path is preserved as `info.localPath`.
     */
    private loadV2Format(snapshot: CodebaseSnapshotV2): void {
        console.log('[SNAPSHOT-DEBUG] Loading v2 format snapshot');

        const validIndexedCodebases: string[] = [];
        const validFileCount = new Map<string, number>();
        const validCodebaseInfoMap = new Map<string, CodebaseInfo>();

        for (const [rawKey, rawInfo] of Object.entries(snapshot.codebases)) {
            const { canonKey, localPath, info } = this.migrateEntryToCanonical(rawKey, rawInfo);

            if (localPath && !fs.existsSync(localPath)) {
                console.warn(`[SNAPSHOT-DEBUG] Codebase no longer exists, removing: ${localPath}`);
                this.recentlyRemoved.add(canonKey);
                continue;
            }

            validCodebaseInfoMap.set(canonKey, info);

            if (info.status === 'indexed') {
                validIndexedCodebases.push(canonKey);
                if ('indexedFiles' in info) {
                    validFileCount.set(canonKey, info.indexedFiles);
                }
                console.log(`[SNAPSHOT-DEBUG] Validated indexed codebase: ${canonKey} (localPath=${localPath ?? 'unknown'}, ${info.indexedFiles || '?'} files, ${info.totalChunks || '?'} chunks)`);
            } else if (info.status === 'indexing') {
                console.warn(`[SNAPSHOT] Found interrupted indexing for '${canonKey}', resetting to failed`);
                validCodebaseInfoMap.set(canonKey, {
                    status: 'indexfailed',
                    errorMessage: 'Indexing was interrupted (MCP server restarted)',
                    lastAttemptedPercentage: info.indexingPercentage,
                    ...this.getIndexOptions(info),
                    localPath,
                    lastUpdated: new Date().toISOString()
                });
            } else if (info.status === 'indexfailed') {
                console.warn(`[SNAPSHOT-DEBUG] Found failed indexing codebase: ${canonKey}. Error: ${info.errorMessage}`);
            }
        }

        this.indexedCodebases = validIndexedCodebases;
        this.indexingCodebases = new Map();
        this.codebaseFileCount = validFileCount;
        this.codebaseInfoMap = validCodebaseInfoMap;
    }

    /** Returns canonical keys (not local paths) of all fully-indexed codebases. */
    public getIndexedCodebases(): string[] {
        try {
            if (!fs.existsSync(this.snapshotFilePath)) {
                return [];
            }

            const snapshotData = fs.readFileSync(this.snapshotFilePath, 'utf8');
            const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

            if (this.isV2Format(snapshot)) {
                return Object.entries(snapshot.codebases)
                    .filter(([_, info]) => info.status === 'indexed')
                    .map(([key, info]) => this.migrateEntryToCanonical(key, info).canonKey);
            } else {
                return (snapshot.indexedCodebases || []).map(p => this.canonicalKey(p));
            }
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading indexed codebases from file:`, error);
            return [...this.indexedCodebases];
        }
    }

    /** Returns canonical keys (not local paths) of all in-progress codebases. */
    public getIndexingCodebases(): string[] {
        try {
            if (!fs.existsSync(this.snapshotFilePath)) {
                return [];
            }

            const snapshotData = fs.readFileSync(this.snapshotFilePath, 'utf8');
            const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

            if (this.isV2Format(snapshot)) {
                return Object.entries(snapshot.codebases)
                    .filter(([_, info]) => info.status === 'indexing')
                    .map(([key, info]) => this.migrateEntryToCanonical(key, info).canonKey);
            }

            const list: string[] = Array.isArray(snapshot.indexingCodebases)
                ? snapshot.indexingCodebases
                : Object.keys(snapshot.indexingCodebases || {});
            return list.map(p => this.canonicalKey(p));
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading indexing codebases from file:`, error);
            return Array.from(this.indexingCodebases.keys());
        }
    }

    private isSameOrDescendantPath(candidatePath: string, codebasePath: string): boolean {
        const relativePath = path.relative(path.resolve(codebasePath), path.resolve(candidatePath));
        return relativePath === ''
            || (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath));
    }

    /**
     * Find the best matching canonical key among `candidates` for a given local path.
     *
     * For git-based canonical keys (no leading "/") we first compare via the
     * canonical key of the requested local path.  For absolute-path canonical
     * keys we fall back to path-prefix matching.
     */
    private findBestMatchingCodebasePath(localPath: string, candidates: string[]): string | undefined {
        const requestedCanonKey = this.canonicalKey(localPath);

        // Fast path: exact canonical key match (covers shared-index scenario)
        if (candidates.includes(requestedCanonKey)) {
            return requestedCanonKey;
        }

        // Slow path: for absolute-path canonical keys, do prefix matching on the
        // stored localPath so that a search under a sub-directory still resolves.
        let bestMatch: string | undefined;
        let bestMatchLength = -1;

        for (const candidate of candidates) {
            // Non-absolute candidate = git remote URL → check canonical key equality only
            if (!this.isLocalPathKey(candidate)) continue;

            const resolvedCandidate = path.resolve(candidate);
            if (!this.isSameOrDescendantPath(localPath, resolvedCandidate)) continue;

            if (resolvedCandidate.length > bestMatchLength) {
                bestMatch = candidate;
                bestMatchLength = resolvedCandidate.length;
            }
        }

        if (bestMatch) return bestMatch;

        // Last resort: check stored localPath fields for git-remote keys
        for (const candidate of candidates) {
            if (this.isLocalPathKey(candidate)) continue;
            const info = this.codebaseInfoMap.get(candidate);
            if (!info?.localPath) continue;
            const resolvedLocal = path.resolve(info.localPath);
            if (this.isSameOrDescendantPath(localPath, resolvedLocal)) {
                if (resolvedLocal.length > bestMatchLength) {
                    bestMatch = candidate;
                    bestMatchLength = resolvedLocal.length;
                }
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
        return this.findBestMatchingCodebasePath(codebasePath, Array.from(this.codebaseInfoMap.keys()));
    }

    /**
     * @deprecated Use getCodebaseInfo() for individual codebases or iterate through codebases for v2 format support
     */
    public getIndexingCodebasesWithProgress(): Map<string, number> {
        return new Map(this.indexingCodebases);
    }

    public getIndexingProgress(localPath: string): number | undefined {
        const key = this.canonicalKey(localPath);
        try {
            if (!fs.existsSync(this.snapshotFilePath)) {
                return undefined;
            }
            const snapshotData = fs.readFileSync(this.snapshotFilePath, 'utf8');
            const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);
            if (this.isV2Format(snapshot)) {
                // Try canonical key first, then legacy local-path key
                const info = snapshot.codebases[key] ?? snapshot.codebases[localPath];
                if (info && info.status === 'indexing') {
                    return info.indexingPercentage || 0;
                }
                return undefined;
            } else {
                if (Array.isArray(snapshot.indexingCodebases)) {
                    return snapshot.indexingCodebases.includes(localPath) ? 0 : undefined;
                } else if (snapshot.indexingCodebases && typeof snapshot.indexingCodebases === 'object') {
                    return snapshot.indexingCodebases[localPath];
                }
            }
            return undefined;
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading progress from file for ${localPath}:`, error);
            return this.indexingCodebases.get(key);
        }
    }

    /**
     * @deprecated Use setCodebaseIndexing() instead for v2 format support
     */
    public addIndexingCodebase(codebasePath: string, progress: number = 0): void {
        const key = this.canonicalKey(codebasePath);
        this.indexingCodebases.set(key, progress);
        const info: CodebaseInfoIndexing = {
            status: 'indexing',
            indexingPercentage: progress,
            localPath: codebasePath,
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(key, info);
    }

    /**
     * @deprecated Use setCodebaseIndexing() instead for v2 format support
     */
    public updateIndexingProgress(codebasePath: string, progress: number): void {
        const key = this.canonicalKey(codebasePath);
        if (this.indexingCodebases.has(key)) {
            this.indexingCodebases.set(key, progress);
            const info: CodebaseInfoIndexing = {
                status: 'indexing',
                indexingPercentage: progress,
                localPath: codebasePath,
                lastUpdated: new Date().toISOString()
            };
            this.codebaseInfoMap.set(key, info);
        }
    }

    /**
     * @deprecated Use removeCodebaseCompletely() instead for v2 format support
     */
    public removeIndexingCodebase(codebasePath: string): void {
        const key = this.canonicalKey(codebasePath);
        this.indexingCodebases.delete(key);
        this.codebaseInfoMap.delete(key);
    }

    /**
     * @deprecated Use setCodebaseIndexed() instead for v2 format support
     */
    public addIndexedCodebase(codebasePath: string, fileCount?: number): void {
        const key = this.canonicalKey(codebasePath);
        if (!this.indexedCodebases.includes(key)) {
            this.indexedCodebases.push(key);
        }
        if (fileCount !== undefined) {
            this.codebaseFileCount.set(key, fileCount);
        }
        const info: CodebaseInfoIndexed = {
            status: 'indexed',
            indexedFiles: fileCount || 0,
            totalChunks: 0,
            indexStatus: 'completed',
            localPath: codebasePath,
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(key, info);
    }

    /**
     * @deprecated Use removeCodebaseCompletely() instead for v2 format support
     */
    public removeIndexedCodebase(codebasePath: string): void {
        const key = this.canonicalKey(codebasePath);
        this.indexedCodebases = this.indexedCodebases.filter(k => k !== key);
        this.codebaseFileCount.delete(key);
        this.codebaseInfoMap.delete(key);
    }

    /**
     * @deprecated Use setCodebaseIndexed() instead for v2 format support
     */
    public moveFromIndexingToIndexed(codebasePath: string, fileCount?: number): void {
        this.removeIndexingCodebase(codebasePath);
        this.addIndexedCodebase(codebasePath, fileCount);
    }

    /**
     * @deprecated Use getCodebaseInfo() instead for v2 format support
     */
    public getIndexedFileCount(codebasePath: string): number | undefined {
        return this.codebaseFileCount.get(this.canonicalKey(codebasePath));
    }

    /**
     * @deprecated Use setCodebaseIndexed() with complete stats instead for v2 format support
     */
    public setIndexedFileCount(codebasePath: string, fileCount: number): void {
        this.codebaseFileCount.set(this.canonicalKey(codebasePath), fileCount);
    }

    /**
     * Set codebase to indexing status. Accepts a local absolute path; stores it
     * under the canonical key (git remote URL or absolute path).
     */
    public setCodebaseIndexing(localPath: string, progress: number = 0, indexOptions?: CodebaseIndexOptions): void {
        const key = this.canonicalKey(localPath);
        this.indexingCodebases.set(key, progress);
        this.indexedCodebases = this.indexedCodebases.filter(k => k !== key);
        this.codebaseFileCount.delete(key);

        const resolvedIndexOptions = this.resolveIndexOptions(key, indexOptions);
        const info: CodebaseInfoIndexing = {
            status: 'indexing',
            indexingPercentage: progress,
            ...resolvedIndexOptions,
            localPath,
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(key, info);
    }

    /**
     * Set codebase to indexed status. Accepts a local absolute path; stores it
     * under the canonical key so all team members can find the shared index.
     */
    public setCodebaseIndexed(
        localPath: string,
        stats: { indexedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached' },
        indexOptions?: CodebaseIndexOptions
    ): void {
        // 0/0+completed is a known-bad state — see Issue #295.
        if (stats.indexedFiles === 0 && stats.totalChunks === 0 && stats.status === 'completed') {
            console.error(`[SNAPSHOT] Refusing to write 0/0+completed for '${localPath}' — invalid state. Stack trace:`);
            console.trace();
            return;
        }

        const key = this.canonicalKey(localPath);
        if (!this.indexedCodebases.includes(key)) {
            this.indexedCodebases.push(key);
        }
        this.indexingCodebases.delete(key);
        this.codebaseFileCount.set(key, stats.indexedFiles);

        const resolvedIndexOptions = this.resolveIndexOptions(key, indexOptions);
        const info: CodebaseInfoIndexed = {
            status: 'indexed',
            indexedFiles: stats.indexedFiles,
            totalChunks: stats.totalChunks,
            indexStatus: stats.status,
            ...resolvedIndexOptions,
            localPath,
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(key, info);
    }

    /**
     * Set codebase to failed status.
     */
    public setCodebaseIndexFailed(
        localPath: string,
        errorMessage: string,
        lastAttemptedPercentage?: number,
        indexOptions?: CodebaseIndexOptions
    ): void {
        const key = this.canonicalKey(localPath);
        this.indexedCodebases = this.indexedCodebases.filter(k => k !== key);
        this.indexingCodebases.delete(key);
        this.codebaseFileCount.delete(key);

        const resolvedIndexOptions = this.resolveIndexOptions(key, indexOptions);
        const info: CodebaseInfoIndexFailed = {
            status: 'indexfailed',
            errorMessage,
            lastAttemptedPercentage,
            ...resolvedIndexOptions,
            localPath,
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(key, info);
    }

    /** Returns 'indexed' | 'indexing' | 'indexfailed' | 'not_found' for a canonical key. */
    public getCodebaseStatus(canonKey: string): 'indexed' | 'indexing' | 'indexfailed' | 'not_found' {
        const info = this.codebaseInfoMap.get(canonKey);
        if (!info) return 'not_found';
        return info.status;
    }

    /** Returns complete info for a canonical key. */
    public getCodebaseInfo(canonKey: string): CodebaseInfo | undefined {
        return this.codebaseInfoMap.get(canonKey);
    }

    /** Returns canonical keys of all failed codebases. */
    public getFailedCodebases(): string[] {
        return Array.from(this.codebaseInfoMap.entries())
            .filter(([_, info]) => info.status === 'indexfailed')
            .map(([key, _]) => key);
    }

    /**
     * Completely remove a codebase from all tracking.
     * Accepts either a canonical key or a local absolute path.
     */
    public removeCodebaseCompletely(localPathOrKey: string): void {
        const key = this.isLocalPathKey(localPathOrKey)
            ? this.canonicalKey(localPathOrKey)
            : localPathOrKey;

        this.indexedCodebases = this.indexedCodebases.filter(k => k !== key);
        this.indexingCodebases.delete(key);
        this.codebaseFileCount.delete(key);
        this.codebaseInfoMap.delete(key);
        this.recentlyRemoved.add(key);

        console.log(`[SNAPSHOT-DEBUG] Completely removed codebase from snapshot: ${key}`);
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

            // Always save in v2 format after loading (migration)
            this.saveCodebaseSnapshot();

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error loading snapshot:', error);
            console.log('[SNAPSHOT-DEBUG] Starting with empty codebase list due to snapshot error.');
        }
    }

    private acquireLock(maxRetries = 5, retryInterval = 100): boolean {
        const lockPath = this.snapshotFilePath + '.lock';
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

    private mergeExternalEntry(rawKey: string, rawInfo: CodebaseInfo): void {
        const { canonKey, info } = this.migrateEntryToCanonical(rawKey, rawInfo);

        if (this.codebaseInfoMap.has(canonKey)) return;
        if (this.recentlyRemoved.has(canonKey)) return;

        this.codebaseInfoMap.set(canonKey, info);

        if (info.status === 'indexed') {
            if (!this.indexedCodebases.includes(canonKey)) {
                this.indexedCodebases.push(canonKey);
            }
            if (info.indexedFiles !== undefined) {
                this.codebaseFileCount.set(canonKey, info.indexedFiles);
            }
        } else if (info.status === 'indexing') {
            if (!this.indexingCodebases.has(canonKey)) {
                this.indexingCodebases.set(canonKey, info.indexingPercentage || 0);
            }
        }
    }

    public saveCodebaseSnapshot(): void {
        console.log('[SNAPSHOT-DEBUG] Saving codebase snapshot to:', this.snapshotFilePath);

        const locked = this.acquireLock();
        if (!locked) {
            console.warn('[SNAPSHOT-DEBUG] Failed to acquire lock, saving without lock');
        }

        try {
            // Ensure directory exists
            const snapshotDir = path.dirname(this.snapshotFilePath);
            if (!fs.existsSync(snapshotDir)) {
                fs.mkdirSync(snapshotDir, { recursive: true });
                console.log('[SNAPSHOT-DEBUG] Created snapshot directory:', snapshotDir);
            }

            // Read-merge: merge entries from disk that we don't have in memory
            try {
                if (fs.existsSync(this.snapshotFilePath)) {
                    const diskData = fs.readFileSync(this.snapshotFilePath, 'utf8');
                    const diskSnapshot = JSON.parse(diskData);
                    if (this.isV2Format(diskSnapshot)) {
                        for (const [diskPath, diskInfo] of Object.entries(diskSnapshot.codebases)) {
                            this.mergeExternalEntry(diskPath, diskInfo as CodebaseInfo);
                        }
                    }
                }
            } catch (mergeError) {
                console.warn('[SNAPSHOT-DEBUG] Error reading disk snapshot for merge, continuing with in-memory state:', mergeError);
            }

            // Build v2 format snapshot using the complete info map
            const codebases: Record<string, CodebaseInfo> = {};

            // Add all codebases from the info map
            for (const [codebasePath, info] of this.codebaseInfoMap) {
                codebases[codebasePath] = info;
            }

            const snapshot: CodebaseSnapshotV2 = {
                formatVersion: 'v2',
                codebases: codebases,
                lastUpdated: new Date().toISOString()
            };

            fs.writeFileSync(this.snapshotFilePath, JSON.stringify(snapshot, null, 2));

            // Clear recently removed set after successful save
            this.recentlyRemoved.clear();

            const indexedCount = this.indexedCodebases.length;
            const indexingCount = this.indexingCodebases.size;
            const failedCount = this.getFailedCodebases().length;

            console.log(`[SNAPSHOT-DEBUG] Snapshot saved successfully in v2 format. Indexed: ${indexedCount}, Indexing: ${indexingCount}, Failed: ${failedCount}`);

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error saving snapshot:', error);
        } finally {
            if (locked) {
                this.releaseLock();
            }
        }
    }
}
