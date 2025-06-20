import * as crypto from 'crypto';

export class MerkleNode {
    hash: string;
    left: MerkleNode | null;
    right: MerkleNode | null;

    constructor(hash: string, left: MerkleNode | null = null, right: MerkleNode | null = null) {
        this.hash = hash;
        this.left = left;
        this.right = right;
    }

    static serializeNode(node: MerkleNode | null): any {
        if (!node) return null;
        return {
            hash: node.hash,
            left: MerkleNode.serializeNode(node.left),
            right: MerkleNode.serializeNode(node.right)
        };
    }

    static deserializeNode(data: any): MerkleNode | null {
        if (!data) return null;
        return new MerkleNode(
            data.hash,
            MerkleNode.deserializeNode(data.left),
            MerkleNode.deserializeNode(data.right)
        );
    }
}

export class MerkleTree {
    root: MerkleNode;
    leaves: MerkleNode[];

    constructor(data: string[]) {
        const leaves = data.map(d => new MerkleNode(this.hash(d)));
        this.leaves = leaves;
        this.root = this.buildTree(leaves);
    }

    private hash(data: string): string {
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    private buildTree(nodes: MerkleNode[]): MerkleNode {
        if (nodes.length === 0) {
            return new MerkleNode(this.hash(''));
        }
        if (nodes.length === 1) {
            return nodes[0];
        }

        const parents: MerkleNode[] = [];
        for (let i = 0; i < nodes.length; i += 2) {
            const left = nodes[i];
            const right = (i + 1 < nodes.length) ? nodes[i + 1] : left;
            const parentHash = this.hash(left.hash + right.hash);
            parents.push(new MerkleNode(parentHash, left, right));
        }

        return this.buildTree(parents);
    }

    public getRootHash(): string {
        return this.root.hash;
    }

    public static compare(tree1: MerkleTree, tree2: MerkleTree): { added: string[], removed: string[], modified: string[] } {
        const C1 = new Map(tree1.leaves.map(l => [l.hash, l]));
        const C2 = new Map(tree2.leaves.map(l => [l.hash, l]));

        const added = Array.from(C2.keys()).filter(k => !C1.has(k));
        const removed = Array.from(C1.keys()).filter(k => !C2.has(k));
        
        return { added, removed, modified: [] };
    }

    public serialize(): any {
        return {
            root: MerkleNode.serializeNode(this.root),
            leaves: this.leaves.map(l => MerkleNode.serializeNode(l))
        };
    }

    static deserialize(data: any): MerkleTree {
        const tree = Object.create(MerkleTree.prototype);
        tree.root = MerkleNode.deserializeNode(data.root);
        tree.leaves = (data.leaves || []).map((l: any) => MerkleNode.deserializeNode(l));
        return tree;
    }
} 