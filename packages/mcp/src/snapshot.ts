import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CodebaseSnapshot, CodebaseSnapshotV2 } from "./config.js";
import { withFileLock } from './lock.js';

function isV2(snapshot: CodebaseSnapshot): snapshot is CodebaseSnapshotV2 {
    return (snapshot as CodebaseSnapshotV2).formatVersion === 'v2';
}

export class SnapshotManager {
    private snapshotFilePath: string;
    private indexedCodebases: string[] = [];
    private indexingCodebases: Map<string, number> = new Map();

    constructor() {
        this.snapshotFilePath = path.join(os.homedir(), '.context', 'mcp-codebase-snapshot.json');
    }

    public getIndexedCodebases(): string[] {
        return [...this.indexedCodebases];
    }

    public getIndexingCodebases(): string[] {
        return Array.from(this.indexingCodebases.keys());
    }

    public getIndexingCodebasesWithProgress(): Map<string, number> {
        return new Map(this.indexingCodebases);
    }

    public getIndexingProgress(codebasePath: string): number | undefined {
        return this.indexingCodebases.get(codebasePath);
    }

    public addIndexingCodebase(codebasePath: string, progress: number = 0): void {
        this.indexingCodebases.set(codebasePath, progress);
    }

    public updateIndexingProgress(codebasePath: string, progress: number): void {
        if (this.indexingCodebases.has(codebasePath)) {
            this.indexingCodebases.set(codebasePath, progress);
        }
    }

    public removeIndexingCodebase(codebasePath: string): void {
        this.indexingCodebases.delete(codebasePath);
    }

    public addIndexedCodebase(codebasePath: string): void {
        if (!this.indexedCodebases.includes(codebasePath)) {
            this.indexedCodebases.push(codebasePath);
        }
    }

    public removeIndexedCodebase(codebasePath: string): void {
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
    }

    public moveFromIndexingToIndexed(codebasePath: string): void {
        this.removeIndexingCodebase(codebasePath);
        this.addIndexedCodebase(codebasePath);
    }

    /**
     * Load snapshot from file with file lock protection
     */
    public async loadCodebaseSnapshot(): Promise<void> {
        console.log('[SNAPSHOT-DEBUG] Loading codebase snapshot from:', this.snapshotFilePath);

        try {
            await withFileLock(async () => {
                if (!fs.existsSync(this.snapshotFilePath)) {
                    console.log('[SNAPSHOT-DEBUG] Snapshot file does not exist. Starting with empty codebase list.');
                    return;
                }

                const snapshotData = fs.readFileSync(this.snapshotFilePath, 'utf8');
                const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

                console.log('[SNAPSHOT-DEBUG] Loaded snapshot:', snapshot);

                // Validate indexed codebases
                const validCodebases: string[] = [];
                let indexingCodebasesList: string[] = [];
                let indexingProgress: Record<string, number> = {};

                if (isV2(snapshot)) {
                    // Handle V2
                    for (const [path, info] of Object.entries(snapshot.codebases)) {
                        if (info.status === 'indexed') {
                            if (fs.existsSync(path)) {
                                validCodebases.push(path);
                                console.log(`[SNAPSHOT-DEBUG] Validated codebase: ${path}`);
                            } else {
                                console.warn(`[SNAPSHOT-DEBUG] Codebase no longer exists, removing: ${path}`);
                            }
                        } else if (info.status === 'indexing') {
                            indexingCodebasesList.push(path);
                            indexingProgress[path] = info.indexingPercentage;
                        }
                    }
                } else {
                    // Handle V1
                    for (const codebasePath of snapshot.indexedCodebases) {
                        if (fs.existsSync(codebasePath)) {
                            validCodebases.push(codebasePath);
                            console.log(`[SNAPSHOT-DEBUG] Validated codebase: ${codebasePath}`);
                        } else {
                            console.warn(`[SNAPSHOT-DEBUG] Codebase no longer exists, removing: ${codebasePath}`);
                        }
                    }

                    if (Array.isArray(snapshot.indexingCodebases)) {
                        indexingCodebasesList = snapshot.indexingCodebases;
                        console.log(`[SNAPSHOT-DEBUG] Found legacy indexingCodebases array format with ${indexingCodebasesList.length} entries`);
                    } else if (snapshot.indexingCodebases && typeof snapshot.indexingCodebases === 'object') {
                        indexingProgress = snapshot.indexingCodebases;
                        indexingCodebasesList = Object.keys(indexingProgress);
                        console.log(`[SNAPSHOT-DEBUG] Found new indexingCodebases object format with ${indexingCodebasesList.length} entries`);
                    }
                }

                // Restore valid indexing codebases with their progress
                const validIndexingCodebases = new Map<string, number>();
                for (const codebasePath of indexingCodebasesList) {
                    if (fs.existsSync(codebasePath)) {
                        const progress = indexingProgress[codebasePath] ?? 0;
                        validIndexingCodebases.set(codebasePath, progress);
                        console.log(`[SNAPSHOT-DEBUG] Restored indexing codebase: ${codebasePath} (${progress}%)`);
                    } else {
                        console.warn(`[SNAPSHOT-DEBUG] Indexing codebase no longer exists: ${codebasePath}`);
                    }
                }

                // Update in-memory state
                this.indexedCodebases = validCodebases;
                this.indexingCodebases = validIndexingCodebases;

                console.log(`[SNAPSHOT-DEBUG] Restored ${validCodebases.length} fully indexed codebases.`);
                console.log(`[SNAPSHOT-DEBUG] Restored ${validIndexingCodebases.size} indexing codebases.`);
            });

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error loading snapshot:', error);
            console.log('[SNAPSHOT-DEBUG] Starting with empty codebase list due to snapshot error.');
        }
    }

    /**
     * Save snapshot to file with file lock protection
     */
    public async saveCodebaseSnapshot(): Promise<void> {
        console.log('[SNAPSHOT-DEBUG] Saving codebase snapshot to:', this.snapshotFilePath);

        try {
            await withFileLock(async () => {
                // Ensure directory exists
                const snapshotDir = path.dirname(this.snapshotFilePath);
                if (!fs.existsSync(snapshotDir)) {
                    fs.mkdirSync(snapshotDir, { recursive: true });
                    console.log('[SNAPSHOT-DEBUG] Created snapshot directory:', snapshotDir);
                }

                // Re-read the file to merge any changes made by other processes
                let existingSnapshot: CodebaseSnapshot | null = null;
                if (fs.existsSync(this.snapshotFilePath)) {
                    try {
                        const existingData = fs.readFileSync(this.snapshotFilePath, 'utf8');
                        existingSnapshot = JSON.parse(existingData);
                    } catch (error) {
                        console.warn('[SNAPSHOT-DEBUG] Could not read existing snapshot for merging:', error);
                    }
                }

                // Merge logic: combine data from file and in-memory
                const mergedIndexed = new Set<string>(this.indexedCodebases);
                const mergedIndexing = new Map<string, number>(this.indexingCodebases);

                if (existingSnapshot) {
                    if (isV2(existingSnapshot)) {
                        Object.entries(existingSnapshot.codebases).forEach(([path, info]) => {
                            if (info.status === 'indexed') {
                                mergedIndexed.add(path);
                            } else if (info.status === 'indexing') {
                                const currentProgress = mergedIndexing.get(path) ?? 0;
                                mergedIndexing.set(path, Math.max(currentProgress, info.indexingPercentage));
                            }
                        });
                    } else {
                        // Add indexed codebases from file
                        existingSnapshot.indexedCodebases.forEach(path => mergedIndexed.add(path));

                        // Merge indexing codebases (keep higher progress)
                        if (typeof existingSnapshot.indexingCodebases === 'object' && !Array.isArray(existingSnapshot.indexingCodebases)) {
                            Object.entries(existingSnapshot.indexingCodebases).forEach(([path, progress]) => {
                                const currentProgress = mergedIndexing.get(path) ?? 0;
                                mergedIndexing.set(path, Math.max(currentProgress, progress));
                            });
                        }
                    }
                }

                // Convert to snapshot format
                const indexingCodebasesObject: Record<string, number> = {};
                mergedIndexing.forEach((progress, path) => {
                    indexingCodebasesObject[path] = progress;
                });

                const snapshot: CodebaseSnapshot = {
                    indexedCodebases: Array.from(mergedIndexed),
                    indexingCodebases: indexingCodebasesObject,
                    lastUpdated: new Date().toISOString()
                };

                // Write atomically using temp file
                const tempFile = `${this.snapshotFilePath}.tmp`;
                fs.writeFileSync(tempFile, JSON.stringify(snapshot, null, 2));
                fs.renameSync(tempFile, this.snapshotFilePath);

                console.log('[SNAPSHOT-DEBUG] Snapshot saved successfully. Indexed:', mergedIndexed.size, 'Indexing:', mergedIndexing.size);
            });

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error saving snapshot:', error);
        }
    }

    /**
     * Refresh in-memory state from file
     * Useful to sync with changes made by other processes
     */
    public async refreshFromFile(): Promise<void> {
        console.log('[SNAPSHOT-DEBUG] Refreshing from file...');

        try {
            await withFileLock(async () => {
                if (!fs.existsSync(this.snapshotFilePath)) {
                    return;
                }

                const snapshotData = fs.readFileSync(this.snapshotFilePath, 'utf8');
                const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

                // Update indexed codebases (merge with existing)
                const updatedIndexed = new Set(this.indexedCodebases);

                if (isV2(snapshot)) {
                    Object.entries(snapshot.codebases).forEach(([path, info]) => {
                        if (info.status === 'indexed' && fs.existsSync(path)) {
                            updatedIndexed.add(path);
                        }
                        if (info.status === 'indexing' && fs.existsSync(path)) {
                            const currentProgress = this.indexingCodebases.get(path) ?? 0;
                            this.indexingCodebases.set(path, Math.max(currentProgress, info.indexingPercentage));
                        }
                    });
                } else {
                    snapshot.indexedCodebases.forEach(path => {
                        if (fs.existsSync(path)) {
                            updatedIndexed.add(path);
                        }
                    });

                    // Update indexing codebases (merge progress, keep higher values)
                    if (typeof snapshot.indexingCodebases === 'object' && !Array.isArray(snapshot.indexingCodebases)) {
                        Object.entries(snapshot.indexingCodebases).forEach(([path, progress]) => {
                            if (fs.existsSync(path)) {
                                const currentProgress = this.indexingCodebases.get(path) ?? 0;
                                this.indexingCodebases.set(path, Math.max(currentProgress, progress));
                            }
                        });
                    }
                }

                this.indexedCodebases = Array.from(updatedIndexed);

                console.log('[SNAPSHOT-DEBUG] Refreshed from file. Indexed:', this.indexedCodebases.length, 'Indexing:', this.indexingCodebases.size);
            });
        } catch (error) {
            console.warn('[SNAPSHOT-DEBUG] Error refreshing from file:', error);
        }
    }
}
