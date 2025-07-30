import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CodebaseSnapshot } from "./config.js";

export class SnapshotManager {
    private snapshotFilePath: string;
    private indexedCodebases: string[] = [];
    private indexingCodebases: string[] = [];

    constructor() {
        // Initialize snapshot file path
        this.snapshotFilePath = path.join(os.homedir(), '.codecontext', 'mcp-codebase-snapshot.json');
    }

    public getIndexedCodebases(): string[] {
        return [...this.indexedCodebases];
    }

    public getIndexingCodebases(): string[] {
        return [...this.indexingCodebases];
    }

    public addIndexingCodebase(codebasePath: string): void {
        if (!this.indexingCodebases.includes(codebasePath)) {
            this.indexingCodebases.push(codebasePath);
        }
    }

    public removeIndexingCodebase(codebasePath: string): void {
        this.indexingCodebases = this.indexingCodebases.filter(path => path !== codebasePath);
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
            const validIndexingCodebases: string[] = [];
            for (const codebasePath of snapshot.indexingCodebases || []) {
                if (fs.existsSync(codebasePath)) {
                    console.warn(`[SNAPSHOT-DEBUG] Found interrupted indexing codebase: ${codebasePath}. Treating as not indexed.`);
                    // Don't add to validIndexingCodebases - treat as not indexed
                } else {
                    console.warn(`[SNAPSHOT-DEBUG] Interrupted indexing codebase no longer exists: ${codebasePath}`);
                }
            }

            // Restore state - only fully indexed codebases
            this.indexedCodebases = validCodebases;
            this.indexingCodebases = []; // Reset indexing codebases since they were interrupted

            console.log(`[SNAPSHOT-DEBUG] Restored ${validCodebases.length} fully indexed codebases.`);
            console.log(`[SNAPSHOT-DEBUG] Reset ${snapshot.indexingCodebases?.length || 0} interrupted indexing codebases.`);

            // Save updated snapshot if we removed any invalid paths or reset indexing codebases
            if (validCodebases.length !== snapshot.indexedCodebases.length ||
                (snapshot.indexingCodebases && snapshot.indexingCodebases.length > 0)) {
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

            const snapshot: CodebaseSnapshot = {
                indexedCodebases: this.indexedCodebases,
                indexingCodebases: this.indexingCodebases,
                lastUpdated: new Date().toISOString()
            };

            fs.writeFileSync(this.snapshotFilePath, JSON.stringify(snapshot, null, 2));
            console.log('[SNAPSHOT-DEBUG] Snapshot saved successfully. Indexed codebases:', this.indexedCodebases.length, 'Indexing codebases:', this.indexingCodebases.length);

        } catch (error: any) {
            console.error('[SNAPSHOT-DEBUG] Error saving snapshot:', error);
        }
    }
} 