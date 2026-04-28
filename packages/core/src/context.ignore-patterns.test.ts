import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Context } from './context';
import { VectorDatabase } from './vectordb';

const createVectorDatabase = (): VectorDatabase => ({
    createCollection: jest.fn(),
    createHybridCollection: jest.fn(),
    dropCollection: jest.fn(),
    hasCollection: jest.fn(),
    listCollections: jest.fn(),
    insert: jest.fn(),
    insertHybrid: jest.fn(),
    search: jest.fn(),
    hybridSearch: jest.fn(),
    delete: jest.fn(),
    query: jest.fn(),
    getCollectionDescription: jest.fn(),
    checkCollectionLimit: jest.fn(),
    getCollectionRowCount: jest.fn(),
});

describe('Context ignore pattern isolation', () => {
    let tempRoot: string;
    let originalHome: string | undefined;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-ignore-'));
        const homeDir = path.join(tempRoot, 'home');
        await fs.mkdir(homeDir, { recursive: true });
        originalHome = process.env.HOME;
        process.env.HOME = homeDir;
    });

    afterEach(async () => {
        if (originalHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = originalHome;
        }
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('does not leak file-based ignore patterns between codebases', async () => {
        const projectA = path.join(tempRoot, 'project-a');
        const projectB = path.join(tempRoot, 'project-b');
        await fs.mkdir(projectA);
        await fs.mkdir(projectB);
        await fs.writeFile(path.join(projectA, '.contextignore'), '*.md\n');

        const context = new Context({ vectorDatabase: createVectorDatabase() });

        const projectAIgnores = await context.getEffectiveIgnorePatterns(projectA);
        expect(projectAIgnores).toContain('*.md');

        const projectBIgnores = await context.getEffectiveIgnorePatterns(projectB);
        expect(projectBIgnores).not.toContain('*.md');
    });

    it('does not leak request ignore patterns between calls', async () => {
        const project = path.join(tempRoot, 'project');
        await fs.mkdir(project);
        const context = new Context({ vectorDatabase: createVectorDatabase() });

        const withRequestIgnores = await context.getEffectiveIgnorePatterns(project, ['*.txt']);
        expect(withRequestIgnores).toContain('*.txt');

        const withoutRequestIgnores = await context.getEffectiveIgnorePatterns(project);
        expect(withoutRequestIgnores).not.toContain('*.txt');
    });
});
