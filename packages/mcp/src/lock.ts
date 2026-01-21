import os from 'os';
import path from 'path';
import fs from 'fs';
import lockfile from 'proper-lockfile';

const CONTEXT_DIR = path.join(os.homedir(), '.context');
const SNAPSHOT_LOCK_FILE = path.join(CONTEXT_DIR, 'snapshot.lock');
const LEADER_LOCK_FILE = path.join(CONTEXT_DIR, 'leader.lock');

// Ensure the .context directory exists
if (!fs.existsSync(CONTEXT_DIR)) {
    fs.mkdirSync(CONTEXT_DIR, { recursive: true });
}

// Create snapshot lock file if it doesn't exist
if (!fs.existsSync(SNAPSHOT_LOCK_FILE)) {
    fs.writeFileSync(SNAPSHOT_LOCK_FILE, '');
}

// Create leader lock file if it doesn't exist
if (!fs.existsSync(LEADER_LOCK_FILE)) {
    fs.writeFileSync(LEADER_LOCK_FILE, '');
}

// Leader election state
let isLeader = false;
let lockInterval: any | undefined;

/**
 * Attempt to acquire the leader lock.
 * If successful, this instance becomes the leader.
 * If unsuccessful, it becomes a follower and retries periodically.
 */
export async function acquireLeaderLock(): Promise<boolean> {
    if (isLeader) {
        return true;
    }

    try {
        // Try to acquire the lock immediately without retries
        // proper-lockfile will use flock where available
        await lockfile.lock(LEADER_LOCK_FILE, {
            retries: 0,
            realpath: false
        });

        isLeader = true;
        console.log('[LEADER] Acquired leader lock. This process is now the LEADER.');

        if (lockInterval) {
            clearInterval(lockInterval);
            lockInterval = undefined;
        }
        return true;
    } catch (error: any) {
        // Lock acquisition failed - someone else is leader
        if (isLeader) {
            console.log('[LEADER] Lost leader lock.');
            isLeader = false;
        }

        if (!lockInterval) {
            console.log('[LEADER] Could not acquire leader lock, running as FOLLOWER.');
            // Retry every 5 seconds
            lockInterval = setInterval(async () => {
                await acquireLeaderLock();
            }, 5000);
        }
        return false;
    }
}

/**
 * Check if the current process is the leader
 */
export function isCurrentProcessLeader(): boolean {
    return isLeader;
}

/**
 * Release the leader lock (e.g. on shutdown)
 */
export async function releaseLeaderLock(): Promise<void> {
    if (isLeader) {
        try {
            await lockfile.unlock(LEADER_LOCK_FILE, { realpath: false });
            isLeader = false;
            console.log('[LEADER] Released leader lock.');
        } catch (error) {
            console.error('[LEADER] Error releasing leader lock:', error);
        }
    }
}

/**
 * Execute a function with file lock protection (for snapshot file)
 * Lock is acquired only for the duration of the function execution
 */
export async function withFileLock<T>(
    fn: () => Promise<T>,
    options: { maxRetries?: number; retryDelay?: number } = {}
): Promise<T> {
    const maxRetries = options.maxRetries ?? 10;
    const retryDelay = options.retryDelay ?? 100;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // Acquire lock with short retry interval
            const release = await lockfile.lock(SNAPSHOT_LOCK_FILE, {
                retries: {
                    retries: 5,
                    minTimeout: 50,
                    maxTimeout: 200
                },
                realpath: false,
                stale: 10000 // Consider lock stale after 10 seconds
            });

            try {
                // Execute the protected function
                const result = await fn();
                return result;
            } finally {
                // Always release the lock
                try {
                    await release();
                } catch (releaseError) {
                    console.warn('[LOCK] Warning: Error releasing lock:', releaseError);
                }
            }
        } catch (error: any) {
            lastError = error;

            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    throw new Error(`Failed to acquire lock after ${maxRetries + 1} attempts: ${lastError?.message}`);
}

/**
 * Check if snapshot lock file exists and is locked
 */
export function isLocked(): boolean {
    try {
        return lockfile.checkSync(SNAPSHOT_LOCK_FILE, { realpath: false });
    } catch {
        return false;
    }
}

/**
 * Force unlock in case of stale lock (use with caution)
 */
export async function forceUnlock(): Promise<void> {
    try {
        if (fs.existsSync(SNAPSHOT_LOCK_FILE)) {
            await lockfile.unlock(SNAPSHOT_LOCK_FILE, { realpath: false });
            console.log('[LOCK] Force unlocked stale snapshot lock');
        }
    } catch (error) {
        console.warn('[LOCK] Warning: Could not force unlock:', error);
    }
}

// Cleanup on process exit
process.on('exit', () => {
    try {
        if (isLocked()) {
            lockfile.unlockSync(SNAPSHOT_LOCK_FILE, { realpath: false });
        }
    } catch { }
});

process.on('SIGINT', async () => {
    await releaseLeaderLock();
    await forceUnlock();
    process.exit(130);
});

process.on('SIGTERM', async () => {
    await releaseLeaderLock();
    await forceUnlock();
    process.exit(143);
});