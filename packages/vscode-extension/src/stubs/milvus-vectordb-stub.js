// Stub implementation for MilvusVectorDatabase to avoid gRPC dependencies in VSCode extension
// This file replaces the actual milvus-vectordb.ts when bundling for VSCode

class MilvusVectorDatabase {
    constructor(config) {
        throw new Error('MilvusVectorDatabase (gRPC) is not available in VSCode extension. Use MilvusRestfulVectorDatabase instead.');
    }
}

module.exports = {
    MilvusVectorDatabase
}; 