/**
 * Vitest global setup: provides a minimal in-memory chrome.storage.sync mock
 * so Chrome Extension code can run under Vitest / happy-dom without a real
 * browser environment.
 */

import { vi } from 'vitest';

// In-memory backing store for chrome.storage.sync
const syncStore: Record<string, unknown> = {};

// Listeners registered via chrome.storage.onChanged.addListener
type ChangeListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
) => void;
const changeListeners: ChangeListener[] = [];

const storageSyncMock = {
    get: vi.fn(
        (
            keys: string | string[] | Record<string, unknown> | null,
            callback?: (items: Record<string, unknown>) => void
        ): Promise<Record<string, unknown>> => {
            let result: Record<string, unknown> = {};

            if (keys === null || keys === undefined) {
                result = { ...syncStore };
            } else if (typeof keys === 'string') {
                if (keys in syncStore) result[keys] = syncStore[keys];
            } else if (Array.isArray(keys)) {
                for (const k of keys) {
                    if (k in syncStore) result[k] = syncStore[k];
                }
            } else {
                // object with defaults
                for (const [k, defaultVal] of Object.entries(keys)) {
                    result[k] = k in syncStore ? syncStore[k] : defaultVal;
                }
            }

            if (callback) callback(result);
            return Promise.resolve(result);
        }
    ),
    set: vi.fn(
        (
            items: Record<string, unknown>,
            callback?: () => void
        ): Promise<void> => {
            const changes: Record<string, chrome.storage.StorageChange> = {};
            for (const [k, newValue] of Object.entries(items)) {
                const oldValue = syncStore[k];
                syncStore[k] = newValue;
                changes[k] = { oldValue, newValue };
            }
            // Notify listeners
            for (const listener of changeListeners) {
                listener(changes, 'sync');
            }
            if (callback) callback();
            return Promise.resolve();
        }
    ),
    remove: vi.fn(
        (
            keys: string | string[],
            callback?: () => void
        ): Promise<void> => {
            const keyList = typeof keys === 'string' ? [keys] : keys;
            const changes: Record<string, chrome.storage.StorageChange> = {};
            for (const k of keyList) {
                if (k in syncStore) {
                    changes[k] = { oldValue: syncStore[k], newValue: undefined };
                    delete syncStore[k];
                }
            }
            for (const listener of changeListeners) {
                listener(changes, 'sync');
            }
            if (callback) callback();
            return Promise.resolve();
        }
    ),
    clear: vi.fn((callback?: () => void): Promise<void> => {
        for (const k of Object.keys(syncStore)) {
            delete syncStore[k];
        }
        if (callback) callback();
        return Promise.resolve();
    }),
};

const storageOnChangedMock = {
    addListener: vi.fn((listener: ChangeListener) => {
        changeListeners.push(listener);
    }),
    removeListener: vi.fn((listener: ChangeListener) => {
        const idx = changeListeners.indexOf(listener);
        if (idx !== -1) changeListeners.splice(idx, 1);
    }),
    hasListener: vi.fn((listener: ChangeListener) =>
        changeListeners.includes(listener)
    ),
};

// Attach to global so any import of chrome.storage.sync picks it up
(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
        sync: storageSyncMock,
        onChanged: storageOnChangedMock,
    },
};

// Export helpers for tests that need direct access
export { syncStore, changeListeners, storageSyncMock, storageOnChangedMock };
