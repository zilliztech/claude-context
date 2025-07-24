import * as crypto from 'crypto';

export interface MerkleDAGNode {
    id: string;
    hash: string;
    data: string;
    parents: string[];
    children: string[];
}

export class MerkleDAG {
    nodes: Map<string, MerkleDAGNode>;
    rootIds: string[];

    constructor() {
        this.nodes = new Map();
        this.rootIds = [];
    }

    private hash(data: string): string {
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    public addNode(data: string, parentId?: string): string {
        const nodeId = this.hash(data);
        const node: MerkleDAGNode = {
            id: nodeId,
            hash: nodeId,
            data,
            parents: [],
            children: []
        };

        // If there's a parent, create the relationship
        if (parentId) {
            const parentNode = this.nodes.get(parentId);
            if (parentNode) {
                node.parents.push(parentId);
                parentNode.children.push(nodeId);
                this.nodes.set(parentId, parentNode);
            }
        } else {
            // If no parent, it's a root node
            this.rootIds.push(nodeId);
        }

        this.nodes.set(nodeId, node);
        return nodeId;
    }

    public getNode(nodeId: string): MerkleDAGNode | undefined {
        return this.nodes.get(nodeId);
    }

    public getAllNodes(): MerkleDAGNode[] {
        return Array.from(this.nodes.values());
    }

    public getRootNodes(): MerkleDAGNode[] {
        return this.rootIds.map(id => this.nodes.get(id)!).filter(Boolean);
    }

    public getLeafNodes(): MerkleDAGNode[] {
        return Array.from(this.nodes.values()).filter(node => node.children.length === 0);
    }

    public serialize(): any {
        return {
            nodes: Array.from(this.nodes.entries()),
            rootIds: this.rootIds
        };
    }

    public static deserialize(data: any): MerkleDAG {
        const dag = new MerkleDAG();
        dag.nodes = new Map(data.nodes);
        dag.rootIds = data.rootIds;
        return dag;
    }

    public static compare(dag1: MerkleDAG, dag2: MerkleDAG): { added: string[], removed: string[], modified: string[] } {
        const nodes1 = new Map(Array.from(dag1.getAllNodes()).map(n => [n.id, n]));
        const nodes2 = new Map(Array.from(dag2.getAllNodes()).map(n => [n.id, n]));

        const added = Array.from(nodes2.keys()).filter(k => !nodes1.has(k));
        const removed = Array.from(nodes1.keys()).filter(k => !nodes2.has(k));
        
        // For modified, we'll check if the data has changed for nodes that exist in both
        const modified: string[] = [];
        for (const [id, node1] of Array.from(nodes1.entries())) {
            const node2 = nodes2.get(id);
            if (node2 && node1.data !== node2.data) {
                modified.push(id);
            }
        }

        return { added, removed, modified };
    }
} 