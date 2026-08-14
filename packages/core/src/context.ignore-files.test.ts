import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Context } from './context';

// A one-line `.dockerignore` containing `*` used to filter out an entire
// repository, because ignore-file discovery globbed every `.*ignore` file in the
// codebase root. Discovery is now an allowlist of search-relevant ignore files.

const stubVectorDatabase = {
    // Collection "already exists" so prepareCollection short-circuits before
    // touching embeddings or the network.
    hasCollection: async () => true,
} as any;

const stubSplitter = {
    split: async () => [],
    setSplitterType: () => { },
} as any;

describe('ignore file discovery', () => {
    let tmpHome: string;
    let codebase: string;
    let origHome: string | undefined;

    beforeEach(async () => {
        origHome = process.env.HOME;
        tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-home-'));
        process.env.HOME = tmpHome; // keep the real ~/.context/.contextignore out of it
        codebase = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-repo-'));
        await fs.mkdir(path.join(codebase, 'src'));
        await fs.writeFile(path.join(codebase, 'src', 'a.ts'), 'export const a = 1;\n');
    });

    afterEach(async () => {
        if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
        delete process.env.CUSTOM_IGNORE_FILES;
        await fs.rm(tmpHome, { recursive: true, force: true });
        await fs.rm(codebase, { recursive: true, force: true });
    });

    it('does not apply .dockerignore patterns', async () => {
        await fs.writeFile(path.join(codebase, '.dockerignore'), '*\n');
        await fs.writeFile(path.join(codebase, '.gitignore'), 'build/\n');

        const context = new Context({ vectorDatabase: stubVectorDatabase, codeSplitter: stubSplitter });
        await context.getLoadedIgnorePatterns(codebase);
        const patterns = context.getIgnorePatterns();

        expect(patterns).toContain('build/');
        expect(patterns).not.toContain('*');
    });

    it('applies .dockerignore when explicitly opted in', async () => {
        await fs.writeFile(path.join(codebase, '.dockerignore'), '*\n');
        process.env.CUSTOM_IGNORE_FILES = '.dockerignore';

        const context = new Context({ vectorDatabase: stubVectorDatabase, codeSplitter: stubSplitter });
        await context.getLoadedIgnorePatterns(codebase);

        expect(context.getIgnorePatterns()).toContain('*');
    });

    it('still applies .contextignore', async () => {
        await fs.writeFile(path.join(codebase, '.contextignore'), 'vendor/\n');

        const context = new Context({ vectorDatabase: stubVectorDatabase, codeSplitter: stubSplitter });
        await context.getLoadedIgnorePatterns(codebase);

        expect(context.getIgnorePatterns()).toContain('vendor/');
    });
});
