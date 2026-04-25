/**
 * sample.test.ts
 *
 * Verifies that:
 *  1. The Vitest + happy-dom environment boots correctly.
 *  2. The chrome.storage.sync mock (from setup.ts) is wired up and functional.
 *
 * Real unit tests for retryWithBackoff, validateQdrantConfig, and
 * IndexedDbVectorStore will be added once the sibling PRs that introduce
 * those files land (PR 5 — retry, PR 6 — qdrant config, PR 7 — IndexedDB store).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { syncStore, storageSyncMock } from './setup';

describe('Test framework bootstrap', () => {
    it('happy-dom environment is active', () => {
        // happy-dom exposes a window object
        expect(typeof window).toBe('object');
        expect(typeof document).toBe('object');
    });

    it('chrome global is defined', () => {
        expect(chrome).toBeDefined();
        expect(chrome.storage).toBeDefined();
        expect(chrome.storage.sync).toBeDefined();
    });
});

describe('chrome.storage.sync mock', () => {
    beforeEach(() => {
        // Reset in-memory store between tests
        for (const k of Object.keys(syncStore)) {
            delete syncStore[k];
        }
        // Reset call counts
        storageSyncMock.get.mockClear();
        storageSyncMock.set.mockClear();
        storageSyncMock.remove.mockClear();
        storageSyncMock.clear.mockClear();
    });

    it('set and get a single key', async () => {
        await chrome.storage.sync.set({ apiKey: 'test-key-123' });
        const result = await chrome.storage.sync.get('apiKey');
        expect(result).toEqual({ apiKey: 'test-key-123' });
    });

    it('get returns default values from object keys', async () => {
        const result = await chrome.storage.sync.get({ missing: 'default-val' });
        expect(result).toEqual({ missing: 'default-val' });
    });

    it('get with null returns all stored keys', async () => {
        await chrome.storage.sync.set({ a: 1, b: 2 });
        const result = await chrome.storage.sync.get(null);
        expect(result).toEqual({ a: 1, b: 2 });
    });

    it('remove deletes a key', async () => {
        await chrome.storage.sync.set({ toRemove: 'bye' });
        await chrome.storage.sync.remove('toRemove');
        const result = await chrome.storage.sync.get('toRemove');
        expect(result).toEqual({});
    });

    it('clear removes all keys', async () => {
        await chrome.storage.sync.set({ x: 1, y: 2 });
        await chrome.storage.sync.clear();
        const result = await chrome.storage.sync.get(null);
        expect(result).toEqual({});
    });

    it('onChanged listener fires when a key is set', async () => {
        const changes: Array<Record<string, chrome.storage.StorageChange>> = [];
        const listener = (c: Record<string, chrome.storage.StorageChange>) => {
            changes.push(c);
        };
        chrome.storage.onChanged.addListener(listener);

        await chrome.storage.sync.set({ qdrantUrl: 'http://localhost:6333' });

        expect(changes).toHaveLength(1);
        expect(changes[0].qdrantUrl.newValue).toBe('http://localhost:6333');
        expect(changes[0].qdrantUrl.oldValue).toBeUndefined();

        chrome.storage.onChanged.removeListener(listener);
    });

    it('set is called with the right arguments', async () => {
        await chrome.storage.sync.set({ model: 'text-embedding-3-small' });
        expect(storageSyncMock.set).toHaveBeenCalledWith(
            { model: 'text-embedding-3-small' }
        );
    });
});
