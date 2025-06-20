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

    constructor(rootDir: string) {
        this.rootDir = rootDir;
        this.snapshotPath = this.getSnapshotPath(rootDir);
        this.fileHashes = new Map();
        this.merkleTree = new MerkleTree([]);
    }

    private getSnapshotPath(codebasePath: string): string {
        const homeDir = os.homedir();
        const merkleDir = path.join(homeDir, '.codeindexer', 'merkle');

        const normalizedPath = path.resolve(codebasePath);
        const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
        
        return path.join(merkleDir, `${hash}.json`);
    }

    private async hashFile(filePath: string): Promise<string> {
        const content = await fs.readFile(filePath, 'utf-8');
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    private async generateFileHashes(dir: string): Promise<Map<string, string>> {
        const fileHashes = new Map<string, string>();
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(this.rootDir, fullPath);

            if (entry.isDirectory()) {
                const subHashes = await this.generateFileHashes(fullPath);
                for (const [p, h] of subHashes) {
                    fileHashes.set(p, h);
                }
            } else {
                const hash = await this.hashFile(fullPath);
                fileHashes.set(relativePath, hash);
            }
        }
        return fileHashes;
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
        try {
            const merkleDir = path.dirname(this.snapshotPath);
            await fs.mkdir(merkleDir, { recursive: true });
            const data = JSON.stringify({
                fileHashes: Array.from(this.fileHashes.entries()),
                merkleTree: this.merkleTree.serialize()
            });
            await fs.writeFile(this.snapshotPath, data, 'utf-8');
            console.log(`Saved snapshot to ${this.snapshotPath}`);
        } catch (error) {
            console.error('Failed to save file synchronizer snapshot:', error);
        }
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
                // Snapshot file doesn't exist, which is fine on first run.
                console.log(`Snapshot file not found at ${this.snapshotPath}. Generating new one.`);
                // Generate fresh hashes and save a new snapshot.
                this.fileHashes = await this.generateFileHashes(this.rootDir);
                this.merkleTree = this.buildMerkleTree(this.fileHashes);
                await this.saveSnapshot();
            } else {
                console.error('Failed to load file synchronizer snapshot:', error);
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
            if (error.code !== 'ENOENT') {
                console.error('Failed to delete snapshot file:', error);
            }
        }
    }
} 