import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CodebaseSnapshot } from "./config.js";

export class SnapshotManager {
    private snapshotFilePath: string;
    private indexedCodebases: string[] = [];
    private indexingCodebases: Map<string, number> = new Map(); // Map of codebase path to progress percentage

    constructor() {
        // Initialize snapshot file path
        this.snapshotFilePath = path.join(os.homedir(), '.context', 'mcp-codebase-snapshot.json');
    }

    public getIndexedCodebases(): string[] {
        // Read from JSON file to ensure consistency and persistence
        try {
            if (!fs.existsSync(this.snapshotFilePath)) {
                return [];
            }

            const snapshotData = fs.readFileSync(this.snapshotFilePath, 'utf8');
            const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

            return snapshot.indexedCodebases || [];
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

            // Handle both legacy array format and new object format
            if (Array.isArray(snapshot.indexingCodebases)) {
                // Legacy format: return the array directly
                return snapshot.indexingCodebases;
            } else if (snapshot.indexingCodebases && typeof snapshot.indexingCodebases === 'object') {
                // New format: return the keys of the object
                return Object.keys(snapshot.indexingCodebases);
            }

            return [];
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading indexing codebases from file:`, error);
            // Fallback to memory if file reading fails
            return Array.from(this.indexingCodebases.keys());
        }
    }

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

            // Handle both legacy array format and new object format
            if (Array.isArray(snapshot.indexingCodebases)) {
                // Legacy format: if path exists in array, assume 0% progress
                return snapshot.indexingCodebases.includes(codebasePath) ? 0 : undefined;
            } else if (snapshot.indexingCodebases && typeof snapshot.indexingCodebases === 'object') {
                // New format: return the actual progress percentage
                return snapshot.indexingCodebases[codebasePath];
            }

            return undefined;
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading progress from file for ${codebasePath}:`, error);
            // Fallback to memory if file reading fails
            return this.indexingCodebases.get(codebasePath);
        }
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
            // Support both legacy array format and new object format
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

            console.log(`[SNAPSHOT-DEBUG] Restored ${validCodebases.length} fully indexed codebases.`);
            console.log(`[SNAPSHOT-DEBUG] Reset ${indexingCodebasesList.length} interrupted indexing codebases.`);

            // Save updated snapshot if we removed any invalid paths or reset indexing codebases
            const originalIndexingCount = Array.isArray(snapshot.indexingCodebases)
                ? snapshot.indexingCodebases.length
                : Object.keys(snapshot.indexingCodebases || {}).length;

            if (validCodebases.length !== snapshot.indexedCodebases.length || originalIndexingCount > 0) {
                this.saveCodebaseSnapshot();
            }

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

            // Convert Map to object for JSON serialization
            const indexingCodebasesObject: Record<string, number> = {};
            this.indexingCodebases.forEach((progress, path) => {
                indexingCodebasesObject[path] = progress;
            });

            const snapshot: CodebaseSnapshot = {
                indexedCodebases: this.indexedCodebases,
                indexingCodebases: indexingCodebasesObject,
                lastUpdated: new Date().toISOString()
            };

            fs.writeFileSync(this.snapshotFilePath, JSON.stringify(snapshot, null, 2));
            console.log('[SNAPSHOT-DEBUG] Snapshot saved successfully. Indexed codebases:', this.indexedCodebases.length, 'Indexing codebases:', this.indexingCodebases.size);

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error saving snapshot:', error);
        }
    }
} 