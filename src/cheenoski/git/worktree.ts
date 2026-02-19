import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from '../../lib/logger.js';
import { appendToLedger } from './branch-ledger.js';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8' });
  return stdout.trim();
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  issueNumber: number;
}

/** Generate a PID-namespaced branch name for worktree isolation */
export function worktreeBranchName(issueNumber: number, slug: string): string {
  // Sanitize slug to prevent shell injection
  const safeslug = slug.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `cheenoski-${process.pid}-${issueNumber}-${safeslug}`;
}

/** Generate worktree path in a temp-adjacent location */
export function worktreePath(repoPath: string, branchName: string): string {
  const repoName = basename(repoPath) || 'repo';
  // Sanitize both repoName and branchName to prevent path traversal
  const safeRepoName = repoName.replace(/[^a-zA-Z0-9_-]/g, '-');
  const safeBranchName = branchName.replace(/[^a-zA-Z0-9_-]/g, '-');
  // Include PID to prevent path collisions between parallel runs of same repo
  return join(tmpdir(), 'cheenoski-worktrees', `${safeRepoName}-${process.pid}-${safeBranchName}`);
}

/**
 * Atomically create a worktree with a new branch from baseBranch.
 * If creation fails partway, cleans up both the worktree directory and branch.
 */
export async function createWorktree(
  repoPath: string,
  baseBranch: string,
  issueNumber: number,
  slug: string,
): Promise<WorktreeInfo> {
  const branch = worktreeBranchName(issueNumber, slug);
  const wtPath = worktreePath(repoPath, branch);

  // Defensive check: detect and clean existing worktree/branch before creation
  try {
    const existingWorktrees = await git(['worktree', 'list', '--porcelain'], repoPath);
    if (existingWorktrees.includes(branch)) {
      logger.warn(`Detected existing worktree for ${branch}, cleaning before retry`);
      await cleanupForRetry(repoPath, wtPath, branch);
    }
  } catch (err) {
    logger.debug(`Pre-creation worktree check failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  try {
    // Create worktree with new branch from base
    await git(['worktree', 'add', '-b', branch, wtPath, baseBranch], repoPath);
    logger.info(`Created worktree: ${branch} at ${wtPath}`);

    appendToLedger({
      action: 'create',
      branch,
      worktree: wtPath,
      issueNumber,
      detail: `from ${baseBranch}`,
    });

    return { path: wtPath, branch, issueNumber };
  } catch (err) {
    // Rollback: try to remove worktree and branch if partially created
    logger.warn(`Worktree creation failed for ${branch}, rolling back`);
    try {
      if (existsSync(wtPath)) {
        await git(['worktree', 'remove', '--force', wtPath], repoPath);
      }
    } catch { /* best effort */ }

    try {
      // Check if branch was created before failure
      await git(['rev-parse', '--verify', branch], repoPath);
      await git(['branch', '-D', branch], repoPath);
    } catch { /* branch didn't exist, nothing to clean */ }

    throw new Error(`Failed to create worktree for issue #${issueNumber}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Prune stale worktree metadata from git's internal records.
 * Safe to call multiple times. Returns true if pruning was successful.
 */
export async function pruneWorktreeMetadata(repoPath: string): Promise<boolean> {
  try {
    await git(['worktree', 'prune'], repoPath);
    logger.debug(`Pruned stale worktree metadata`);
    return true;
  } catch (err) {
    logger.warn(`Failed to prune worktree metadata: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Comprehensive cleanup for retry scenarios.
 * Removes stale git metadata, force-deletes branch, and removes filesystem directory.
 * Idempotent — safe to call multiple times.
 */
export async function cleanupForRetry(
  repoPath: string,
  worktreePath: string | null,
  branchName: string,
): Promise<void> {
  // Step 1: Prune stale worktree metadata
  await pruneWorktreeMetadata(repoPath);

  // Step 2: Verify no lingering worktree references
  try {
    const output = await git(['worktree', 'list', '--porcelain'], repoPath);
    if (output.includes(branchName)) {
      logger.warn(`Worktree metadata still references ${branchName} after prune`);
    }
  } catch (err) {
    logger.debug(`Could not verify worktree list: ${err instanceof Error ? err.message : err}`);
  }

  // Step 3: Force-delete branch (ignore errors if doesn't exist)
  try {
    await git(['branch', '-D', branchName], repoPath);
    logger.debug(`Force-deleted branch: ${branchName}`);
  } catch (err) {
    // Branch may not exist — this is expected on first retry
    logger.debug(`Branch deletion skipped (may not exist): ${branchName}`);
  }

  // Step 4: Remove filesystem directory
  if (worktreePath) {
    try {
      await rm(worktreePath, { recursive: true, force: true });
      logger.debug(`Removed worktree directory: ${worktreePath}`);
    } catch (err) {
      logger.warn(`Failed to remove worktree directory ${worktreePath}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * Remove a worktree and optionally its branch.
 * Safe to call even if the worktree doesn't exist.
 */
export async function removeWorktree(
  repoPath: string,
  wtPath: string,
  branchName: string,
  issueNumber: number,
  deleteBranch = false,
): Promise<void> {
  try {
    if (existsSync(wtPath)) {
      await git(['worktree', 'remove', '--force', wtPath], repoPath);
      logger.debug(`Removed worktree: ${wtPath}`);
    }
  } catch (err) {
    logger.warn(`Failed to remove worktree ${wtPath}: ${err instanceof Error ? err.message : err}`);
  }

  if (deleteBranch) {
    try {
      await git(['branch', '-D', branchName], repoPath);
      logger.debug(`Deleted branch: ${branchName}`);
      appendToLedger({
        action: 'delete',
        branch: branchName,
        worktree: wtPath,
        issueNumber,
        detail: 'cleanup after removal',
      });
    } catch (err) {
      logger.warn(`Failed to delete branch ${branchName}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/** List all active Cheenoski worktrees */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const result: WorktreeInfo[] = [];

  try {
    const output = await git(['worktree', 'list', '--porcelain'], repoPath);
    const blocks = output.split('\n\n').filter(Boolean);

    for (const block of blocks) {
      const lines = block.split('\n');
      const worktreeLine = lines.find(l => l.startsWith('worktree '));
      const branchLine = lines.find(l => l.startsWith('branch '));

      if (!worktreeLine || !branchLine) continue;

      const path = worktreeLine.replace('worktree ', '');
      const branch = branchLine.replace('branch refs/heads/', '');

      // Validate branch name pattern before trusting it
      const match = branch.match(/^cheenoski-(\d+)-(\d+)-/);
      if (match) {
        const pid = parseInt(match[1], 10);
        const issueNum = parseInt(match[2], 10);
        if (!isNaN(pid) && !isNaN(issueNum)) {
          result.push({
            path,
            branch,
            issueNumber: issueNum,
          });
        }
      }
    }
  } catch (err) {
    logger.debug(`Could not list worktrees: ${err instanceof Error ? err.message : err}`);
  }

  return result;
}
