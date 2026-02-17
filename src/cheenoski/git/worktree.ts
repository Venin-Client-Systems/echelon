import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
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
  return `cheenoski-${process.pid}-${issueNumber}-${slug}`;
}

/** Generate worktree path in a temp-adjacent location */
export function worktreePath(repoPath: string, branchName: string): string {
  const repoName = basename(repoPath) || 'repo';
  return join(tmpdir(), 'cheenoski-worktrees', `${repoName}-${branchName}`);
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

      const match = branch.match(/^cheenoski-\d+-(\d+)-/);
      if (match) {
        result.push({
          path,
          branch,
          issueNumber: parseInt(match[1], 10),
        });
      }
    }
  } catch {
    logger.debug('Could not list worktrees');
  }

  return result;
}
