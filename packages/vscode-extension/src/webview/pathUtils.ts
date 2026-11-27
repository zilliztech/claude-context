import * as path from 'path';

export function resolveWorkspaceFilePath(workspaceRoot: string, relativePath: unknown): string | undefined {
    if (!workspaceRoot || typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
        return undefined;
    }

    const rootPath = path.resolve(workspaceRoot);
    const candidatePath = path.resolve(rootPath, relativePath);
    const pathFromRoot = path.relative(rootPath, candidatePath);

    if (pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !path.isAbsolute(pathFromRoot))) {
        return candidatePath;
    }

    return undefined;
}
