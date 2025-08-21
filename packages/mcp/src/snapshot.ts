import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
    CodebaseSnapshot,
    CodebaseSnapshotV1,
    CodebaseSnapshotV2,
    CodebaseInfo,
    CodebaseInfoIndexing,
    CodebaseInfoIndexed,
    CodebaseInfoIndexFailed
} from "./config.js";

export class SnapshotManager {
    private snapshotFilePath: string;
    private indexedCodebases: string[] = [];
    private indexingCodebases: Map<string, number> = new Map(); // Map of codebase path to progress percentage
    private codebaseFileCount: Map<string, number> = new Map(); // Map of codebase path to indexed file count
    private codebaseInfoMap: Map<string, CodebaseInfo> = new Map(); // Map of codebase path to complete info

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

            // Store the complete info for this codebase
            validCodebaseInfoMap.set(codebasePath, info);

            if (info.status === 'indexed') {
                validIndexedCodebases.push(codebasePath);
                if ('indexedFiles' in info) {
                    validFileCount.set(codebasePath, info.indexedFiles);
                }
                console.log(`[SNAPSHOT-DEBUG] Validated indexed codebase: ${codebasePath} (${info.indexedFiles || 'unknown'} files, ${info.totalChunks || 'unknown'} chunks)`);
            } else if (info.status === 'indexing') {
                if ('indexingPercentage' in info) {
                    validIndexingCodebases.set(codebasePath, info.indexingPercentage);
                }
                console.warn(`[SNAPSHOT-DEBUG] Found interrupted indexing codebase: ${codebasePath} (${info.indexingPercentage || 0}%). Treating as not indexed.`);
                // Don't add to indexed - treat interrupted indexing as not indexed
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
        this.codebaseInfoMap.set(codebasePath, info);
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

            // Always save in v2 format after loading (migration)
            this.saveCodebaseSnapshot();

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error loading snapshot:', error);
            console.log('[SNAPSHOT-DEBUG] Starting with empty codebase list due to snapshot error.');
        }
    }

    public saveCodebaseSnapshot(): void {
        console.log('[SNAPSHOT-DEBUG] Saving codebase snapshot to:', this.snapshotFilePath);

        try {
            // Ensure directory exists
            const snapshotDir = path.dirname(this.snapshotFilePath);
            if (!fs.existsSync(snapshotDir)) {
                fs.mkdirSync(snapshotDir, { recursive: true });
                console.log('[SNAPSHOT-DEBUG] Created snapshot directory:', snapshotDir);
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

            const indexedCount = this.indexedCodebases.length;
            const indexingCount = this.indexingCodebases.size;
            const failedCount = this.getFailedCodebases().length;

            console.log(`[SNAPSHOT-DEBUG] Snapshot saved successfully in v2 format. Indexed: ${indexedCount}, Indexing: ${indexingCount}, Failed: ${failedCount}`);

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error saving snapshot:', error);
        }
    }
} 