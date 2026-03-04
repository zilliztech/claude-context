import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import {
    CodebaseSnapshot,
    CodebaseSnapshotV1,
    CodebaseSnapshotV2,
    CodebaseInfo,
    CodebaseInfoIndexing,
    CodebaseInfoIndexed,
    CodebaseInfoIndexFailed
} from "./config.js";

type SnapshotScope = 'workspace' | 'global';

interface SnapshotManagerOptions {
    workspacePath?: string;
    scope?: SnapshotScope;
    saveDebounceMs?: number;
}

export class SnapshotManager {
    private snapshotFilePath: string;
    private lockFilePath: string;
    private legacySnapshotFilePath: string;
    private scope: SnapshotScope;
    private workspacePath: string;
    private indexedCodebases: string[] = [];
    private indexingCodebases: Map<string, number> = new Map(); // Map of codebase path to progress percentage
    private codebaseFileCount: Map<string, number> = new Map(); // Map of codebase path to indexed file count
    private codebaseInfoMap: Map<string, CodebaseInfo> = new Map(); // Map of codebase path to complete info
    private pendingDeletes: Map<string, string> = new Map(); // Map of codebase path to delete timestamp
    private readonly lockAcquireTimeoutMs: number;
    private readonly lockRetryIntervalMs: number;
    private readonly lockRetryJitterMs: number;
    private readonly lockStaleMs: number;
    private readonly saveDebounceMs: number;
    private pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingSaveReason: string | null = null;
    private saveQueue: Promise<void> = Promise.resolve();
    private lockWaitMsTotal = 0;
    private lockRetryCountTotal = 0;
    private lockTimeoutCount = 0;

    constructor(options: SnapshotManagerOptions = {}) {
        this.workspacePath = path.resolve(options.workspacePath || process.cwd());
        this.scope = options.scope || this.resolveSnapshotScope();
        this.lockAcquireTimeoutMs = this.parsePositiveNumber(process.env.MCP_SNAPSHOT_LOCK_TIMEOUT_MS, 15000);
        this.lockRetryIntervalMs = this.parsePositiveNumber(process.env.MCP_SNAPSHOT_LOCK_RETRY_MS, 50);
        this.lockRetryJitterMs = this.parsePositiveNumber(process.env.MCP_SNAPSHOT_LOCK_JITTER_MS, 40);
        this.lockStaleMs = this.parsePositiveNumber(process.env.MCP_SNAPSHOT_LOCK_STALE_MS, 120000);
        this.saveDebounceMs = this.parsePositiveNumber(
            process.env.MCP_SNAPSHOT_SAVE_DEBOUNCE_MS,
            options.saveDebounceMs ?? 2000
        );
        this.legacySnapshotFilePath = path.join(os.homedir(), '.context', 'mcp-codebase-snapshot.json');
        this.snapshotFilePath = this.resolveSnapshotPath();
        this.lockFilePath = `${this.snapshotFilePath}.lock`;

        console.log(
            `[SNAPSHOT-DEBUG] Snapshot scope='${this.scope}', workspace='${this.workspacePath}', file='${this.snapshotFilePath}'`
        );
    }

    private parsePositiveNumber(rawValue: string | undefined, fallback: number): number {
        if (!rawValue) {
            return fallback;
        }

        const value = Number(rawValue);
        if (Number.isFinite(value) && value > 0) {
            return value;
        }

        return fallback;
    }

    private resolveSnapshotScope(): SnapshotScope {
        const rawScope = (process.env.MCP_SNAPSHOT_SCOPE || 'workspace').toLowerCase();
        return rawScope === 'global' ? 'global' : 'workspace';
    }

    private resolveSnapshotPath(): string {
        if (this.scope === 'global') {
            return this.legacySnapshotFilePath;
        }

        const workspaceHash = crypto
            .createHash('sha256')
            .update(this.workspacePath)
            .digest('hex')
            .slice(0, 16);

        return path.join(os.homedir(), '.context', 'mcp', workspaceHash, 'mcp-codebase-snapshot.json');
    }

    private isPathWithinWorkspace(candidatePath: string): boolean {
        const absoluteCandidate = path.resolve(candidatePath);
        return absoluteCandidate === this.workspacePath || absoluteCandidate.startsWith(`${this.workspacePath}${path.sep}`);
    }

    private filterSnapshotForWorkspace(snapshot: CodebaseSnapshotV2): CodebaseSnapshotV2 {
        const filteredCodebases: Record<string, CodebaseInfo> = {};

        for (const [codebasePath, info] of Object.entries(snapshot.codebases)) {
            if (this.isPathWithinWorkspace(codebasePath)) {
                filteredCodebases[codebasePath] = info;
            }
        }

        return {
            formatVersion: 'v2',
            codebases: filteredCodebases,
            lastUpdated: new Date().toISOString()
        };
    }

    private migrateLegacySnapshotIfNeeded(): void {
        if (this.scope !== 'workspace') {
            return;
        }

        if (fs.existsSync(this.snapshotFilePath)) {
            return;
        }

        const legacySnapshot = this.readSnapshotFileUnsafe(this.legacySnapshotFilePath, false);
        if (!legacySnapshot) {
            return;
        }

        const filteredSnapshot = this.filterSnapshotForWorkspace(legacySnapshot);
        const migratedCount = Object.keys(filteredSnapshot.codebases).length;
        if (migratedCount === 0) {
            return;
        }

        this.writeSnapshotToDiskUnsafe(filteredSnapshot, this.snapshotFilePath);
        console.log(
            `[SNAPSHOT-DEBUG] Migrated ${migratedCount} codebase(s) from legacy snapshot to workspace-scoped snapshot`
        );
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
    }

    private async cleanupStaleLockFileIfNeeded(): Promise<void> {
        try {
            const stat = await fs.promises.stat(this.lockFilePath);
            if ((Date.now() - stat.mtimeMs) > this.lockStaleMs) {
                await fs.promises.unlink(this.lockFilePath);
                console.warn(`[SNAPSHOT-DEBUG] Removed stale snapshot lock: ${this.lockFilePath}`);
            }
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.warn('[SNAPSHOT-DEBUG] Failed to inspect snapshot lock file:', error);
            }
        }
    }

    private async withSnapshotLock<T>(callback: () => Promise<T>): Promise<T> {
        const lockDir = path.dirname(this.lockFilePath);
        await fs.promises.mkdir(lockDir, { recursive: true });

        const start = Date.now();
        let retryCount = 0;

        while (true) {
            let lockHandle: fs.promises.FileHandle | null = null;

            try {
                lockHandle = await fs.promises.open(this.lockFilePath, 'wx');
                await lockHandle.writeFile(`${process.pid}:${Date.now()}`);

                const lockWaitMs = Date.now() - start;
                this.lockWaitMsTotal += lockWaitMs;
                this.lockRetryCountTotal += retryCount;

                if (retryCount > 0 || lockWaitMs >= this.lockRetryIntervalMs) {
                    console.log(
                        `[SNAPSHOT-LOCK] wait_ms=${lockWaitMs} retries=${retryCount} total_wait_ms=${this.lockWaitMsTotal} total_retries=${this.lockRetryCountTotal}`
                    );
                }

                try {
                    return await callback();
                } finally {
                    if (lockHandle !== null) {
                        try {
                            await lockHandle.close();
                        } catch {
                            // Ignore close errors
                        }
                    }
                    try {
                        await fs.promises.unlink(this.lockFilePath);
                    } catch (error: any) {
                        if (error.code !== 'ENOENT') {
                            console.warn('[SNAPSHOT-DEBUG] Failed to remove snapshot lock file:', error);
                        }
                    }
                }
            } catch (error: any) {
                if (lockHandle !== null) {
                    try {
                        await lockHandle.close();
                    } catch {
                        // Ignore close errors
                    }
                }

                if (error.code !== 'EEXIST') {
                    throw error;
                }

                retryCount += 1;
                await this.cleanupStaleLockFileIfNeeded();

                if ((Date.now() - start) >= this.lockAcquireTimeoutMs) {
                    this.lockTimeoutCount += 1;
                    const waitedMs = Date.now() - start;
                    throw new Error(
                        `Timeout acquiring snapshot lock: ${this.lockFilePath} (waited ${waitedMs}ms, retries ${retryCount}, total_timeouts ${this.lockTimeoutCount})`
                    );
                }

                const jitter = this.lockRetryJitterMs > 0
                    ? Math.floor(Math.random() * this.lockRetryJitterMs)
                    : 0;

                await this.sleep(this.lockRetryIntervalMs + jitter);
            }
        }
    }

    private buildSnapshotFromMemory(): CodebaseSnapshotV2 {
        const codebases: Record<string, CodebaseInfo> = {};

        for (const [codebasePath, info] of this.codebaseInfoMap) {
            codebases[codebasePath] = info;
        }

        return {
            formatVersion: 'v2',
            codebases,
            lastUpdated: new Date().toISOString()
        };
    }

    private applySnapshotToMemory(snapshot: CodebaseSnapshotV2): void {
        const indexedCodebases: string[] = [];
        const indexingCodebases = new Map<string, number>();
        const codebaseFileCount = new Map<string, number>();
        const codebaseInfoMap = new Map<string, CodebaseInfo>();

        for (const [codebasePath, info] of Object.entries(snapshot.codebases)) {
            codebaseInfoMap.set(codebasePath, info);

            if (info.status === 'indexed') {
                indexedCodebases.push(codebasePath);
                codebaseFileCount.set(codebasePath, info.indexedFiles || 0);
            } else if (info.status === 'indexing') {
                indexingCodebases.set(codebasePath, info.indexingPercentage || 0);
            }
        }

        this.indexedCodebases = indexedCodebases;
        this.indexingCodebases = indexingCodebases;
        this.codebaseFileCount = codebaseFileCount;
        this.codebaseInfoMap = codebaseInfoMap;
    }

    private convertV1ToV2(snapshot: CodebaseSnapshotV1): CodebaseSnapshotV2 {
        const codebases: Record<string, CodebaseInfo> = {};
        const now = new Date().toISOString();
        const snapshotTime = snapshot.lastUpdated || now;

        for (const codebasePath of snapshot.indexedCodebases || []) {
            codebases[codebasePath] = {
                status: 'indexed',
                indexedFiles: 0,
                totalChunks: 0,
                indexStatus: 'completed',
                lastUpdated: snapshotTime
            };
        }

        const indexingCodebases = snapshot.indexingCodebases;
        if (Array.isArray(indexingCodebases)) {
            for (const codebasePath of indexingCodebases) {
                codebases[codebasePath] = {
                    status: 'indexing',
                    indexingPercentage: 0,
                    lastUpdated: snapshotTime
                };
            }
        } else if (indexingCodebases && typeof indexingCodebases === 'object') {
            for (const [codebasePath, progress] of Object.entries(indexingCodebases)) {
                codebases[codebasePath] = {
                    status: 'indexing',
                    indexingPercentage: typeof progress === 'number' ? progress : 0,
                    lastUpdated: snapshotTime
                };
            }
        }

        return {
            formatVersion: 'v2',
            codebases,
            lastUpdated: snapshotTime
        };
    }

    private readSnapshotFileUnsafe(snapshotPath: string, rotateCorruptFile: boolean): CodebaseSnapshotV2 | null {
        if (!fs.existsSync(snapshotPath)) {
            return null;
        }

        try {
            const snapshotData = fs.readFileSync(snapshotPath, 'utf8');
            const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

            if (this.isV2Format(snapshot)) {
                return snapshot;
            }

            return this.convertV1ToV2(snapshot);
        } catch (error: any) {
            console.warn('[SNAPSHOT-DEBUG] Failed to parse snapshot from disk:', error);
            if (!rotateCorruptFile) {
                return null;
            }

            try {
                const corruptedPath = `${snapshotPath}.corrupt.${Date.now()}`;
                fs.renameSync(snapshotPath, corruptedPath);
                console.warn(`[SNAPSHOT-DEBUG] Corrupted snapshot moved to: ${corruptedPath}`);
            } catch (rotateError: any) {
                if (rotateError.code !== 'ENOENT') {
                    console.warn('[SNAPSHOT-DEBUG] Failed to rotate corrupted snapshot file:', rotateError);
                }
            }
            return null;
        }
    }

    private readSnapshotFromDiskUnsafe(): CodebaseSnapshotV2 | null {
        return this.readSnapshotFileUnsafe(this.snapshotFilePath, true);
    }

    private writeSnapshotToDiskUnsafe(snapshot: CodebaseSnapshotV2, snapshotPath: string = this.snapshotFilePath): void {
        const snapshotDir = path.dirname(snapshotPath);
        if (!fs.existsSync(snapshotDir)) {
            fs.mkdirSync(snapshotDir, { recursive: true });
            console.log('[SNAPSHOT-DEBUG] Created snapshot directory:', snapshotDir);
        }

        const tempPath = `${snapshotPath}.${process.pid}.${Date.now()}.tmp`;
        try {
            fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2));
            fs.renameSync(tempPath, snapshotPath);
        } catch (error) {
            try {
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
            } catch {
                // Ignore temp file cleanup errors
            }
            throw error;
        }
    }

    private toTimestamp(value: string | undefined): number {
        if (!value) {
            return 0;
        }

        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    private mergeSnapshots(existingSnapshot: CodebaseSnapshotV2 | null, localSnapshot: CodebaseSnapshotV2): CodebaseSnapshotV2 {
        const mergedCodebases: Record<string, CodebaseInfo> = {};

        if (existingSnapshot) {
            for (const [codebasePath, info] of Object.entries(existingSnapshot.codebases)) {
                mergedCodebases[codebasePath] = info;
            }
        }

        for (const [codebasePath, localInfo] of Object.entries(localSnapshot.codebases)) {
            const existingInfo = mergedCodebases[codebasePath];
            if (!existingInfo || this.toTimestamp(localInfo.lastUpdated) >= this.toTimestamp(existingInfo.lastUpdated)) {
                mergedCodebases[codebasePath] = localInfo;
            }
        }

        for (const [codebasePath, deletedAt] of this.pendingDeletes.entries()) {
            const currentInfo = mergedCodebases[codebasePath];
            if (!currentInfo || this.toTimestamp(deletedAt) >= this.toTimestamp(currentInfo.lastUpdated)) {
                delete mergedCodebases[codebasePath];
            }
        }

        return {
            formatVersion: 'v2',
            codebases: mergedCodebases,
            lastUpdated: new Date().toISOString()
        };
    }

    private markCodebaseDeleted(codebasePath: string): void {
        this.pendingDeletes.set(codebasePath, new Date().toISOString());
    }

    private clearPendingSaveTimer(): void {
        if (this.pendingSaveTimer) {
            clearTimeout(this.pendingSaveTimer);
            this.pendingSaveTimer = null;
        }
        this.pendingSaveReason = null;
    }

    private enqueueSave(reason: string): Promise<void> {
        this.saveQueue = this.saveQueue
            .catch(() => {
                // Keep queue alive even if prior save failed.
            })
            .then(async () => {
                await this.performSaveCodebaseSnapshot(reason);
            });
        return this.saveQueue;
    }

    public scheduleSaveCodebaseSnapshot(reason: string = 'scheduled', delayMs: number = this.saveDebounceMs): void {
        this.pendingSaveReason = reason;

        if (delayMs <= 0) {
            const immediateReason = this.pendingSaveReason || 'scheduled-immediate';
            this.pendingSaveReason = null;
            void this.enqueueSave(immediateReason).catch((error: any) => {
                console.error('[SNAPSHOT-DEBUG] Error during immediate scheduled snapshot save:', error);
            });
            return;
        }

        if (this.pendingSaveTimer) {
            return;
        }

        this.pendingSaveTimer = setTimeout(() => {
            const scheduledReason = this.pendingSaveReason || 'scheduled';
            this.pendingSaveReason = null;
            this.pendingSaveTimer = null;
            void this.enqueueSave(scheduledReason).catch((error: any) => {
                console.error('[SNAPSHOT-DEBUG] Error during scheduled snapshot save:', error);
            });
        }, delayMs);
    }

    public async flushScheduledSave(): Promise<void> {
        if (this.pendingSaveTimer) {
            clearTimeout(this.pendingSaveTimer);
            this.pendingSaveTimer = null;
            const reason = this.pendingSaveReason || 'scheduled-flush';
            this.pendingSaveReason = null;
            await this.enqueueSave(reason);
            return;
        }

        await this.saveQueue;
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

        for (const [codebasePath, info] of Object.entries(snapshot.codebases)) {
            if (!fs.existsSync(codebasePath)) {
                console.warn(`[SNAPSHOT-DEBUG] Codebase no longer exists, removing: ${codebasePath}`);
                continue;
            }

            if (info.status === 'indexed') {
                // Store the complete info for indexed codebases
                validCodebaseInfoMap.set(codebasePath, info);
                validIndexedCodebases.push(codebasePath);
                if ('indexedFiles' in info) {
                    validFileCount.set(codebasePath, info.indexedFiles);
                }
                console.log(`[SNAPSHOT-DEBUG] Validated indexed codebase: ${codebasePath} (${info.indexedFiles || 'unknown'} files, ${info.totalChunks || 'unknown'} chunks)`);
            } else if (info.status === 'indexing') {
                console.warn(`[SNAPSHOT-DEBUG] Found interrupted indexing codebase: ${codebasePath} (${info.indexingPercentage || 0}%). Treating as not indexed.`);
                // Interrupted indexing should not block future indexing attempts.
                // Convert it into a failed status to preserve diagnostics while avoiding stale "indexing" locks.
                const interruptedInfo: CodebaseInfoIndexFailed = {
                    status: 'indexfailed',
                    errorMessage: 'Indexing was interrupted (likely due to MCP restart). Please run index_codebase again.',
                    lastAttemptedPercentage: info.indexingPercentage,
                    lastUpdated: new Date().toISOString()
                };
                validCodebaseInfoMap.set(codebasePath, interruptedInfo);
            } else if (info.status === 'indexfailed') {
                validCodebaseInfoMap.set(codebasePath, info);
                console.warn(`[SNAPSHOT-DEBUG] Found failed indexing codebase: ${codebasePath}. Error: ${info.errorMessage}`);
                // Failed indexing codebases are not added to indexed or indexing lists
                // But we keep the info for potential retry
            }
        }

        // Restore state
        this.indexedCodebases = validIndexedCodebases;
        this.indexingCodebases = validIndexingCodebases;
        this.codebaseFileCount = validFileCount;
        this.codebaseInfoMap = validCodebaseInfoMap;
    }

    public getIndexedCodebases(): string[] {
        // Read from JSON file to ensure consistency and persistence
        try {
            const snapshot = this.readSnapshotFromDiskUnsafe();
            if (!snapshot) {
                return [];
            }

            return Object.entries(snapshot.codebases)
                .filter(([_, info]) => info.status === 'indexed')
                .map(([codebasePath, _]) => codebasePath);
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading indexed codebases from file:`, error);
            // Fallback to memory if file reading fails
            return [...this.indexedCodebases];
        }
    }

    public getIndexingCodebases(): string[] {
        // Read from JSON file to ensure consistency and persistence
        try {
            const snapshot = this.readSnapshotFromDiskUnsafe();
            if (!snapshot) {
                return [];
            }

            return Object.entries(snapshot.codebases)
                .filter(([_, info]) => info.status === 'indexing')
                .map(([codebasePath, _]) => codebasePath);
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading indexing codebases from file:`, error);
            // Fallback to memory if file reading fails
            return Array.from(this.indexingCodebases.keys());
        }
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
            const snapshot = this.readSnapshotFromDiskUnsafe();
            if (!snapshot) {
                return undefined;
            }

            const info = snapshot.codebases[codebasePath];
            if (info && info.status === 'indexing') {
                return info.indexingPercentage || 0;
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
        this.pendingDeletes.delete(codebasePath);

        // Also update codebaseInfoMap for v2 compatibility
        const info: CodebaseInfoIndexing = {
            status: 'indexing',
            indexingPercentage: progress,
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(codebasePath, info);
    }

    /**
     * @deprecated Use setCodebaseIndexing() instead for v2 format support
     */
    public updateIndexingProgress(codebasePath: string, progress: number): void {
        if (this.indexingCodebases.has(codebasePath)) {
            this.indexingCodebases.set(codebasePath, progress);
            this.pendingDeletes.delete(codebasePath);

            // Also update codebaseInfoMap for v2 compatibility
            const info: CodebaseInfoIndexing = {
                status: 'indexing',
                indexingPercentage: progress,
                lastUpdated: new Date().toISOString()
            };
            this.codebaseInfoMap.set(codebasePath, info);
        }
    }

    /**
     * @deprecated Use removeCodebaseCompletely() or state-specific methods instead for v2 format support
     */
    public removeIndexingCodebase(codebasePath: string): void {
        this.indexingCodebases.delete(codebasePath);
        // Also remove from codebaseInfoMap for v2 compatibility
        this.codebaseInfoMap.delete(codebasePath);
        this.markCodebaseDeleted(codebasePath);
    }

    /**
     * @deprecated Use setCodebaseIndexed() instead for v2 format support
     */
    public addIndexedCodebase(codebasePath: string, fileCount?: number): void {
        if (!this.indexedCodebases.includes(codebasePath)) {
            this.indexedCodebases.push(codebasePath);
        }
        this.pendingDeletes.delete(codebasePath);
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
        this.codebaseInfoMap.set(codebasePath, info);
    }

    /**
     * @deprecated Use removeCodebaseCompletely() or state-specific methods instead for v2 format support
     */
    public removeIndexedCodebase(codebasePath: string): void {
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.codebaseFileCount.delete(codebasePath);
        // Also remove from codebaseInfoMap for v2 compatibility
        this.codebaseInfoMap.delete(codebasePath);
        this.markCodebaseDeleted(codebasePath);
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
    public setCodebaseIndexing(codebasePath: string, progress: number = 0): void {
        this.indexingCodebases.set(codebasePath, progress);
        this.pendingDeletes.delete(codebasePath);

        // Remove from other states
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.codebaseFileCount.delete(codebasePath);

        // Update info map
        const info: CodebaseInfoIndexing = {
            status: 'indexing',
            indexingPercentage: progress,
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(codebasePath, info);
    }

    /**
     * Set codebase to indexed status with complete statistics
     */
    public setCodebaseIndexed(
        codebasePath: string,
        stats: { indexedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached' }
    ): void {
        this.pendingDeletes.delete(codebasePath);

        // Add to indexed list if not already there
        if (!this.indexedCodebases.includes(codebasePath)) {
            this.indexedCodebases.push(codebasePath);
        }

        // Remove from indexing state
        this.indexingCodebases.delete(codebasePath);

        // Update file count and info
        this.codebaseFileCount.set(codebasePath, stats.indexedFiles);

        const info: CodebaseInfoIndexed = {
            status: 'indexed',
            indexedFiles: stats.indexedFiles,
            totalChunks: stats.totalChunks,
            indexStatus: stats.status,
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(codebasePath, info);
    }

    /**
     * Set codebase to failed status
     */
    public setCodebaseIndexFailed(
        codebasePath: string,
        errorMessage: string,
        lastAttemptedPercentage?: number
    ): void {
        this.pendingDeletes.delete(codebasePath);

        // Remove from other states
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.indexingCodebases.delete(codebasePath);
        this.codebaseFileCount.delete(codebasePath);

        // Update info map
        const info: CodebaseInfoIndexFailed = {
            status: 'indexfailed',
            errorMessage: errorMessage,
            lastAttemptedPercentage: lastAttemptedPercentage,
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(codebasePath, info);
    }

    /**
     * Get codebase status
     */
    public getCodebaseStatus(codebasePath: string): 'indexed' | 'indexing' | 'indexfailed' | 'not_found' {
        const info = this.codebaseInfoMap.get(codebasePath);
        if (!info) return 'not_found';
        return info.status;
    }

    /**
     * Get complete codebase information
     */
    public getCodebaseInfo(codebasePath: string): CodebaseInfo | undefined {
        return this.codebaseInfoMap.get(codebasePath);
    }

    /**
     * Get all failed codebases
     */
    public getFailedCodebases(): string[] {
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
        this.codebaseInfoMap.delete(codebasePath);
        this.markCodebaseDeleted(codebasePath);

        console.log(`[SNAPSHOT-DEBUG] Completely removed codebase from snapshot: ${codebasePath}`);
    }

    public loadCodebaseSnapshot(): void {
        console.log('[SNAPSHOT-DEBUG] Loading codebase snapshot from:', this.snapshotFilePath);

        try {
            this.pendingDeletes.clear();
            this.migrateLegacySnapshotIfNeeded();

            const snapshot = this.readSnapshotFromDiskUnsafe();
            if (!snapshot) {
                console.log('[SNAPSHOT-DEBUG] Snapshot file does not exist. Starting with empty codebase list.');
                return;
            }

            console.log('[SNAPSHOT-DEBUG] Loaded snapshot:', snapshot);

            this.loadV2Format(snapshot);

            // Always save in v2 format after loading (migration)
            void this.saveCodebaseSnapshot('post-load-migration').catch((error: any) => {
                console.error('[SNAPSHOT-DEBUG] Error persisting post-load migration snapshot:', error);
            });

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error loading snapshot:', error);
            console.log('[SNAPSHOT-DEBUG] Starting with empty codebase list due to snapshot error.');
        }
    }

    private async performSaveCodebaseSnapshot(reason: string): Promise<void> {
        console.log(`[SNAPSHOT-DEBUG] Saving codebase snapshot to: ${this.snapshotFilePath} (reason=${reason})`);

        const mergedSnapshot = await this.withSnapshotLock(async () => {
            const existingSnapshot = this.readSnapshotFromDiskUnsafe();
            const localSnapshot = this.buildSnapshotFromMemory();
            const merged = this.mergeSnapshots(existingSnapshot, localSnapshot);
            this.writeSnapshotToDiskUnsafe(merged);
            this.applySnapshotToMemory(merged);
            this.pendingDeletes.clear();
            return merged;
        });

        const statuses = Object.values(mergedSnapshot.codebases);
        const indexedCount = statuses.filter((info) => info.status === 'indexed').length;
        const indexingCount = statuses.filter((info) => info.status === 'indexing').length;
        const failedCount = statuses.filter((info) => info.status === 'indexfailed').length;

        console.log(`[SNAPSHOT-DEBUG] Snapshot saved successfully in v2 format. Indexed: ${indexedCount}, Indexing: ${indexingCount}, Failed: ${failedCount}`);
    }

    public async saveCodebaseSnapshot(reason: string = 'manual'): Promise<void> {
        this.clearPendingSaveTimer();
        await this.enqueueSave(reason);
    }
}
