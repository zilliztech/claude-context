import { VectorDatabase, VectorDocument, SearchOptions, VectorSearchResult } from './types';

// Common configuration interface for Milvus implementations
export interface BaseMilvusConfig {
    address?: string;
    token?: string;
    username?: string;
    password?: string;
}

/**
 * Abstract base class for Milvus vector database implementations
 * Provides common initialization logic for address resolution and environment management
 */
export abstract class AbstractMilvusVectorDatabase implements VectorDatabase {
    protected config: BaseMilvusConfig;
    protected initializationPromise: Promise<void>;

    constructor(config: BaseMilvusConfig) {
        this.config = config;

        // Start initialization asynchronously without waiting
        this.initializationPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        const resolvedAddress = await this.resolveAddress();
        await this.initializeClient(resolvedAddress);
    }

    /**
     * Resolve address from config or token
     * Common logic for both gRPC and REST implementations
     */
    protected async resolveAddress(): Promise<string> {
        let finalConfig = { ...this.config };

        // If address is not provided, get it using token
        if (!finalConfig.address && finalConfig.token) {
            const { ClusterManager } = await import('./zilliz-utils');
            finalConfig.address = await ClusterManager.getAddressFromToken(finalConfig.token);
        }

        if (!finalConfig.address) {
            throw new Error('Address is required and could not be resolved from token');
        }

        return finalConfig.address;
    }

    /**
     * Initialize the specific client implementation
     * Must be implemented by subclasses
     */
    protected abstract initializeClient(address: string): Promise<void>;

    /**
     * Ensure initialization is complete before method execution
     */
    protected async ensureInitialized(): Promise<void> {
        await this.initializationPromise;
    }

    // Abstract methods that must be implemented by subclasses
    abstract createCollection(collectionName: string, dimension: number, description?: string): Promise<void>;
    abstract dropCollection(collectionName: string): Promise<void>;
    abstract hasCollection(collectionName: string): Promise<boolean>;
    abstract insert(collectionName: string, documents: VectorDocument[]): Promise<void>;
    abstract search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]>;
    abstract delete(collectionName: string, ids: string[]): Promise<void>;
    abstract query(collectionName: string, filter: string, outputFields: string[]): Promise<Record<string, any>[]>;
} 