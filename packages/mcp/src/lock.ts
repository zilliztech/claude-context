
import os from 'os';
import path from 'path';
import fs from 'fs';
import lockfile from 'proper-lockfile';

const CONTEXT_DIR = path.join(os.homedir(), '.context');
const LOCK_FILE = path.join(CONTEXT_DIR, 'leader.lock');

// Ensure the .context directory exists
if (!fs.existsSync(CONTEXT_DIR)) {
  fs.mkdirSync(CONTEXT_DIR, { recursive: true });
}

let isLeader = false;
let lockInterval: NodeJS.Timeout | undefined;

export async function acquireLock(): Promise<boolean> {
    if (isLeader) {
        return true;
    }
    try {
        // Using flock is generally more reliable as the lock is released by the OS if the process dies.
        // proper-lockfile will use flock on systems that support it (Linux, BSD, etc.)
        // and fall back to other mechanisms on systems that don't (like Windows).
        await lockfile.lock(LOCK_FILE, { retries: 0, realpath: false });
        isLeader = true;
        console.log('Acquired leader lock. This process is now the leader.');
        if (lockInterval) {
            clearInterval(lockInterval);
            lockInterval = undefined;
        }
        return true;
    } catch (error) {
        console.log('Could not acquire leader lock, running as follower.');
        isLeader = false;
        if (!lockInterval) {
            lockInterval = setInterval(acquireLock, 5000); // Check every 5 seconds
        }
        return false;
    }
}

export async function releaseLock(): Promise<void> {
  if (isLeader) {
    try {
      await lockfile.unlock(LOCK_FILE, { realpath: false });
      isLeader = false;
      console.log('Released leader lock.');
    } catch (error) {
      console.error('Error releasing leader lock:', error);
    }
  }
}

export function isCurrentProcessLeader(): boolean {
  return isLeader;
}

export function getLockFilePath(): string {
  return LOCK_FILE;
}

// Graceful shutdown
process.on('exit', async () => {
  await releaseLock();
});

process.on('SIGINT', async () => {
  await releaseLock();
  process.exit();
});

process.on('SIGTERM', async () => {
  await releaseLock();
  process.exit();
});
