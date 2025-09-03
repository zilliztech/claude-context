module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts'],
    collectCoverageFrom: [
        'src/vectordb/*.ts',
        '!src/vectordb/types.ts', // Exclude type definitions
        '!src/vectordb/index.ts'  // Exclude barrel exports
    ],
    coveragePathIgnorePatterns: ['/node_modules/'],
    testTimeout: 60000, // 1 minute timeout for database operations
    verbose: true,
    setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
    // Ensure tests run sequentially to avoid database conflicts
    maxConcurrency: 1
};