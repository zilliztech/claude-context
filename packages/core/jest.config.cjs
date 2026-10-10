module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    moduleNameMapper: {
        '^tree-sitter$': '<rootDir>/jest.tree-sitter.cjs',
    },
};
