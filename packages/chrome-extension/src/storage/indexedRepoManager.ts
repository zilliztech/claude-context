export interface IndexedRepository {
    id: string;
    owner: string;
    repo: string;
    indexedAt: number;
    totalFiles: number;
    totalChunks: number;
    lastSearchAt?: number;
    collectionName: string;
}

export class IndexedRepoManager {
    private static readonly STORAGE_KEY = 'indexedRepositories';

    static async addIndexedRepo(repo: Omit<IndexedRepository, 'indexedAt'>): Promise<void> {
        const repoData: IndexedRepository = {
            ...repo,
            indexedAt: Date.now()
        };

        const existingRepos = await this.getIndexedRepos();
        const updatedRepos = existingRepos.filter(r => r.id !== repo.id);
        updatedRepos.unshift(repoData);

        const limitedRepos = updatedRepos.slice(0, 5);

        return new Promise((resolve, reject) => {
            chrome.storage.local.set(
                { [this.STORAGE_KEY]: limitedRepos },
                () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    static async getIndexedRepos(): Promise<IndexedRepository[]> {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get([this.STORAGE_KEY], (items) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(items[this.STORAGE_KEY] || []);
                }
            });
        });
    }

    static async isRepoIndexed(repoId: string): Promise<IndexedRepository | null> {
        const repos = await this.getIndexedRepos();
        return repos.find(repo => repo.id === repoId) || null;
    }

    static async removeIndexedRepo(repoId: string): Promise<void> {
        const existingRepos = await this.getIndexedRepos();
        const updatedRepos = existingRepos.filter(r => r.id !== repoId);

        return new Promise((resolve, reject) => {
            chrome.storage.local.set(
                { [this.STORAGE_KEY]: updatedRepos },
                () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    static async updateLastSearchTime(repoId: string): Promise<void> {
        const repos = await this.getIndexedRepos();
        const repo = repos.find(r => r.id === repoId);
        
        if (repo) {
            repo.lastSearchAt = Date.now();
            
            return new Promise((resolve, reject) => {
                chrome.storage.local.set(
                    { [this.STORAGE_KEY]: repos },
                    () => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve();
                        }
                    }
                );
            });
        }
    }

    static async getRecentlyIndexedRepos(limit: number = 10): Promise<IndexedRepository[]> {
        const repos = await this.getIndexedRepos();
        return repos
            .sort((a, b) => b.indexedAt - a.indexedAt)
            .slice(0, limit);
    }

    static async cleanupOldRepos(daysOld: number = 30): Promise<void> {
        const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
        const repos = await this.getIndexedRepos();
        const activeRepos = repos.filter(repo => repo.indexedAt > cutoffTime);

        return new Promise((resolve, reject) => {
            chrome.storage.local.set(
                { [this.STORAGE_KEY]: activeRepos },
                () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }
}
