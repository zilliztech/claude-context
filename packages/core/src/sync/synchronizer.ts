import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { MerkleTree } from './merkle';
import * as os from 'os';

export class FileSynchronizer {
    private fileHashes: Map<string, string>;
    private merkleTree: MerkleTree;
    private rootDir: string;
    private snapshotPath: string;
    private ignorePatterns: string[];

    constructor(rootDir: string, ignorePatterns: string[] = []) {
        this.rootDir = rootDir;
        this.snapshotPath = this.getSnapshotPath(rootDir);
        this.fileHashes = new Map();
        this.merkleTree = new MerkleTree([]);
        this.ignorePatterns = ignorePatterns;
    }

    private getSnapshotPath(codebasePath: string): string {
        const homeDir = os.homedir();
        const merkleDir = path.join(homeDir, '.codeindexer', 'merkle');

        const normalizedPath = path.resolve(codebasePath);
        const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');

        return path.join(merkleDir, `${hash}.json`);
    }

    private async hashFile(filePath: string): Promise<string> {
        // Double-check that this is actually a file, not a directory
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
            throw new Error(`Attempted to hash a directory: ${filePath}`);
        }
        const content = await fs.readFile(filePath, 'utf-8');
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    private async generateFileHashes(dir: string): Promise<Map<string, string>> {
        const fileHashes = new Map<string, string>();

        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (error: any) {
            console.warn(`Cannot read directory ${dir}: ${error.message}`);
            return fileHashes;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(this.rootDir, fullPath);

            // Check if this path should be ignored BEFORE any file system operations
            if (this.shouldIgnore(relativePath, entry.isDirectory())) {
                continue; // Skip completely - no access at all
            }

            // Double-check with fs.stat to be absolutely sure about file type
            let stat;
            try {
                stat = await fs.stat(fullPath);
            } catch (error: any) {
                console.warn(`Cannot stat ${fullPath}: ${error.message}`);
                continue;
            }

            if (stat.isDirectory()) {
                // Verify it's really a directory and not ignored
                if (!this.shouldIgnore(relativePath, true)) {
                    const subHashes = await this.generateFileHashes(fullPath);
                    for (const [p, h] of subHashes) {
                        fileHashes.set(p, h);
                    }
                }
            } else if (stat.isFile()) {
                // Verify it's really a file and not ignored
                if (!this.shouldIgnore(relativePath, false)) {
                    try {
                        const hash = await this.hashFile(fullPath);
                        fileHashes.set(relativePath, hash);
                    } catch (error: any) {
                        console.warn(`Cannot hash file ${fullPath}: ${error.message}`);
                        continue;
                    }
                }
            }
            // Skip other types (symlinks, etc.)
        }
        return fileHashes;
    }

    private shouldIgnore(relativePath: string, isDirectory: boolean = false): boolean {
        if (this.ignorePatterns.length === 0) {
            return false;
        }

        // Normalize path separators and remove leading/trailing slashes
        const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

        if (!normalizedPath) {
            return false; // Don't ignore root
        }

        // Check direct pattern matches first
        for (const pattern of this.ignorePatterns) {
            if (this.matchPattern(normalizedPath, pattern, isDirectory)) {
                return true;
            }
        }

        // Check if any parent directory is ignored
        const pathParts = normalizedPath.split('/');
        for (let i = 0; i < pathParts.length; i++) {
            const partialPath = pathParts.slice(0, i + 1).join('/');
            for (const pattern of this.ignorePatterns) {
                // Check directory patterns
                if (pattern.endsWith('/')) {
                    const dirPattern = pattern.slice(0, -1);
                    if (this.simpleGlobMatch(partialPath, dirPattern) ||
                        this.simpleGlobMatch(pathParts[i], dirPattern)) {
                        return true;
                    }
                }
                // Check exact path patterns
                else if (pattern.includes('/')) {
                    if (this.simpleGlobMatch(partialPath, pattern)) {
                        return true;
                    }
                }
                // Check filename patterns against any path component
                else {
                    if (this.simpleGlobMatch(pathParts[i], pattern)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    private matchPattern(filePath: string, pattern: string, isDirectory: boolean = false): boolean {
        // Clean both path and pattern
        const cleanPath = filePath.replace(/^\/+|\/+$/g, '');
        const cleanPattern = pattern.replace(/^\/+|\/+$/g, '');

        if (!cleanPath || !cleanPattern) {
            return false;
        }

        // Handle directory patterns (ending with /)
        if (pattern.endsWith('/')) {
            if (!isDirectory) return false; // Directory pattern only matches directories
            const dirPattern = cleanPattern.slice(0, -1);

            // Direct match or any path component matches
            return this.simpleGlobMatch(cleanPath, dirPattern) ||
                cleanPath.split('/').some(part => this.simpleGlobMatch(part, dirPattern));
        }

        // Handle path patterns (containing /)
        if (cleanPattern.includes('/')) {
            return this.simpleGlobMatch(cleanPath, cleanPattern);
        }

        // Handle filename patterns (no /) - match against basename
        const fileName = path.basename(cleanPath);
        return this.simpleGlobMatch(fileName, cleanPattern);
    }

    private simpleGlobMatch(text: string, pattern: string): boolean {
        if (!text || !pattern) return false;

        // Convert glob pattern to regex
        const regexPattern = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
            .replace(/\*/g, '.*'); // Convert * to .*

        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(text);
    }

    private buildMerkleTree(fileHashes: Map<string, string>): MerkleTree {
        const sortedPaths = Array.from(fileHashes.keys()).sort();
        const data = sortedPaths.map(p => p + fileHashes.get(p));
        return new MerkleTree(data);
    }

    public async initialize() {
        console.log(`Initializing file synchronizer for ${this.rootDir}`);
        await this.loadSnapshot();
        this.merkleTree = this.buildMerkleTree(this.fileHashes);
        console.log(`File synchronizer initialized. Loaded ${this.fileHashes.size} file hashes.`);
    }

    public async checkForChanges(): Promise<{ added: string[], removed: string[], modified: string[] }> {
        console.log('Checking for file changes...');

        const newFileHashes = await this.generateFileHashes(this.rootDir);
        const newMerkleTree = this.buildMerkleTree(newFileHashes);

        if (this.merkleTree.getRootHash() === newMerkleTree.getRootHash()) {
            console.log('No changes detected based on Merkle root hash.');
            return { added: [], removed: [], modified: [] };
        }

        console.log('Merkle root hash has changed. Comparing file states...');
        const changes = this.compareStates(this.fileHashes, newFileHashes);

        this.fileHashes = newFileHashes;
        this.merkleTree = newMerkleTree;
        await this.saveSnapshot();

        if (changes.added.length > 0 || changes.removed.length > 0 || changes.modified.length > 0) {
            console.log(`Found changes: ${changes.added.length} added, ${changes.removed.length} removed, ${changes.modified.length} modified.`);
        } else {
            console.log('No file-level changes detected after detailed comparison.');
        }

        return changes;
    }

    private compareStates(oldHashes: Map<string, string>, newHashes: Map<string, string>): { added: string[], removed: string[], modified: string[] } {
        const added: string[] = [];
        const removed: string[] = [];
        const modified: string[] = [];

        for (const [file, hash] of newHashes.entries()) {
            if (!oldHashes.has(file)) {
                added.push(file);
            } else if (oldHashes.get(file) !== hash) {
                modified.push(file);
            }
        }

        for (const file of oldHashes.keys()) {
            if (!newHashes.has(file)) {
                removed.push(file);
            }
        }

        return { added, removed, modified };
    }

    public getFileHash(filePath: string): string | undefined {
        return this.fileHashes.get(filePath);
    }

    private async saveSnapshot(): Promise<void> {
        const merkleDir = path.dirname(this.snapshotPath);
        await fs.mkdir(merkleDir, { recursive: true });
        const data = JSON.stringify({
            fileHashes: Array.from(this.fileHashes.entries()),
            merkleTree: this.merkleTree.serialize()
        });
        await fs.writeFile(this.snapshotPath, data, 'utf-8');
        console.log(`Saved snapshot to ${this.snapshotPath}`);
    }

    private async loadSnapshot(): Promise<void> {
        try {
            const data = await fs.readFile(this.snapshotPath, 'utf-8');
            const obj = JSON.parse(data);
            this.fileHashes = new Map(obj.fileHashes);
            if (obj.merkleTree) {
                this.merkleTree = MerkleTree.deserialize(obj.merkleTree);
            }
            console.log(`Loaded snapshot from ${this.snapshotPath}`);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.log(`Snapshot file not found at ${this.snapshotPath}. Generating new one.`);
                this.fileHashes = await this.generateFileHashes(this.rootDir);
                this.merkleTree = this.buildMerkleTree(this.fileHashes);
                await this.saveSnapshot();
            } else {
                throw error;
            }
        }
    }

    /**
     * Delete snapshot file for a given codebase path
     */
    static async deleteSnapshot(codebasePath: string): Promise<void> {
        const homeDir = os.homedir();
        const merkleDir = path.join(homeDir, '.codeindexer', 'merkle');
        const normalizedPath = path.resolve(codebasePath);
        const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
        const snapshotPath = path.join(merkleDir, `${hash}.json`);

        try {
            await fs.unlink(snapshotPath);
            console.log(`Deleted snapshot file: ${snapshotPath}`);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.log(`Snapshot file not found (already deleted): ${snapshotPath}`);
            } else {
                console.error(`Failed to delete snapshot file ${snapshotPath}:`, error.message);
                throw error; // Re-throw non-ENOENT errors
            }
        }
    }
} 