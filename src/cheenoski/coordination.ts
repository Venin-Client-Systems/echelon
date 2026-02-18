import { join } from 'node:path';
import { homedir, hostname } from 'node:os';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  readdirSync, unlinkSync,
} from 'node:fs';
import type { InstanceLock } from './types.js';
import { logger } from '../lib/logger.js';

const CHEENOSKI_HOME = join(homedir(), '.cheenoski');
const INSTANCES_DIR = join(CHEENOSKI_HOME, 'instances');
const CLAIMS_DIR = join(CHEENOSKI_HOME, 'claims');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function lockFilePath(pid: number): string {
  return join(INSTANCES_DIR, `${pid}.lock`);
}

function claimFilePath(issueNumber: number): string {
  return join(CLAIMS_DIR, `${issueNumber}.claim`);
}

/** Create a lock file for this Cheenoski instance */
export function acquireLock(label: string): void {
  ensureDir(INSTANCES_DIR);

  const lock: InstanceLock = {
    pid: process.pid,
    label,
    startedAt: new Date().toISOString(),
    hostname: hostname(),
    issues: [],
  };

  writeFileSync(lockFilePath(process.pid), JSON.stringify(lock, null, 2), 'utf-8');
  logger.debug('Lock acquired', { pid: process.pid, label });
}

/** Release this instance's lock file */
export function releaseLock(): void {
  const path = lockFilePath(process.pid);
  try {
    if (existsSync(path)) {
      unlinkSync(path);
      logger.debug('Lock released', { pid: process.pid });
    }
  } catch {
    // Best effort
  }
}

/** Read a lock file */
function readLock(path: string): InstanceLock | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** Check if a PID is still running */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Get all active Cheenoski instances */
export function getActiveInstances(): InstanceLock[] {
  ensureDir(INSTANCES_DIR);
  const locks: InstanceLock[] = [];

  for (const file of readdirSync(INSTANCES_DIR)) {
    if (!file.endsWith('.lock')) continue;
    const fullPath = join(INSTANCES_DIR, file);
    const lock = readLock(fullPath);

    if (!lock) {
      // Corrupt lock file — clean up
      try {
        unlinkSync(fullPath);
        logger.debug(`Removed corrupt lock file: ${file}`);
      } catch { /* best effort */ }
      continue;
    }

    if (isAlive(lock.pid)) {
      locks.push(lock);
    } else {
      // Stale lock — clean up
      try {
        unlinkSync(fullPath);
        logger.debug(`Removed stale lock for PID ${lock.pid}: ${file}`);
      } catch { /* best effort */ }
    }
  }

  return locks;
}

/**
 * Atomically claim an issue using exclusive file creation.
 * Uses `flag: 'wx'` (O_CREAT | O_EXCL) so only one process can create the claim file.
 */
export function claimIssue(issueNumber: number): boolean {
  ensureDir(CLAIMS_DIR);
  const claimPath = claimFilePath(issueNumber);

  // Try atomic claim first (wx flag fails if file already exists)
  try {
    const claim = { pid: process.pid, claimedAt: new Date().toISOString() };
    writeFileSync(claimPath, JSON.stringify(claim), { encoding: 'utf-8', flag: 'wx' });
    logger.debug(`Claimed issue #${issueNumber}`);
    return true;
  } catch (err) {
    // File exists — check if stale and retry once
    try {
      const data = JSON.parse(readFileSync(claimPath, 'utf-8'));
      // Validate claim data structure
      if (!data || typeof data.pid !== 'number') {
        throw new Error('Invalid claim data');
      }
      // If the claiming PID is still alive, the claim is valid
      if (isAlive(data.pid)) {
        logger.debug(`Issue #${issueNumber} already claimed by PID ${data.pid}`);
        return false;
      }
      // Stale claim — remove it and retry claim atomically
      logger.debug(`Removing stale claim for issue #${issueNumber} (PID ${data.pid} dead)`);
      unlinkSync(claimPath);

      // Retry claim immediately after removing stale claim
      try {
        const claim = { pid: process.pid, claimedAt: new Date().toISOString() };
        writeFileSync(claimPath, JSON.stringify(claim), { encoding: 'utf-8', flag: 'wx' });
        logger.debug(`Claimed issue #${issueNumber} after removing stale claim`);
        return true;
      } catch (retryErr) {
        // Another process claimed between our unlink and write — that's fine
        logger.debug(`Failed to claim issue #${issueNumber} after stale removal (race lost)`);
        return false;
      }
    } catch (readErr) {
      // Corrupt claim file or read error — try to remove and give up
      logger.debug(`Corrupt/unreadable claim file for issue #${issueNumber}, removing: ${readErr instanceof Error ? readErr.message : readErr}`);
      try { unlinkSync(claimPath); } catch { /* ignore */ }
      return false; // Don't retry after corrupt file — avoid infinite loop
    }
  }
}

/** Release an issue claim */
export function releaseIssue(issueNumber: number): void {
  const claimPath = claimFilePath(issueNumber);
  try {
    if (existsSync(claimPath)) {
      // Only release if we own it
      const data = JSON.parse(readFileSync(claimPath, 'utf-8'));
      if (data.pid === process.pid) {
        unlinkSync(claimPath);
        logger.debug(`Released claim on issue #${issueNumber}`);
      }
    }
  } catch {
    // Best effort
  }
}

/** Check if any other Cheenoski instance is running with the same label */
export function hasConflictingInstance(label: string): InstanceLock | null {
  const others = getActiveInstances().filter(l => l.pid !== process.pid && l.label === label);
  return others[0] ?? null;
}
