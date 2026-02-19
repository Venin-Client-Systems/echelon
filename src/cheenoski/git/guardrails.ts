import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';
import { logger } from '../../lib/logger.js';

const execFileAsync = promisify(execFile);

/** Run git command in a given directory */
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8' });
  return stdout.trim();
}

/** Preflight checks before running Cheenoski */
export async function preflightChecks(
  repoPath: string,
  baseBranch: string,
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];

  // 1. Verify repo exists and is a git repo
  try {
    await git(['rev-parse', '--git-dir'], repoPath);
  } catch {
    errors.push(`Not a git repository: ${repoPath}`);
    return { ok: false, errors };
  }

  // 2. Verify base branch exists
  try {
    await git(['rev-parse', '--verify', baseBranch], repoPath);
  } catch {
    errors.push(`Base branch "${baseBranch}" does not exist`);
  }

  // 3. Check that working tree is clean (warn — worktrees are isolated,
  //    and merge function handles stashing)
  try {
    const status = await git(['status', '--porcelain'], repoPath);
    if (status.length > 0) {
      logger.warn(`Working tree has ${status.split('\n').length} uncommitted change(s) — merge function will stash if needed`);
    }
  } catch (err) {
    errors.push(`Failed to check git status: ${err instanceof Error ? err.message : err}`);
  }

  // 4. Verify we're on or can reach base branch
  try {
    const current = await git(['branch', '--show-current'], repoPath);
    if (current !== baseBranch) {
      logger.warn(`Currently on "${current}", not "${baseBranch}" — worktrees will branch from "${baseBranch}"`);
    }
  } catch {
    // Detached HEAD — warn but don't fail
    logger.warn('Detached HEAD state detected');
  }

  // 5. Fetch latest from remote (non-blocking failure)
  try {
    await git(['fetch', '--quiet', 'origin', baseBranch], repoPath);
  } catch {
    logger.warn('Could not fetch from origin — working with local state');
  }

  return { ok: errors.length === 0, errors };
}

/** Scan for orphaned worktrees left by crashed Cheenoski runs */
export async function scanOrphanedWorktrees(repoPath: string): Promise<string[]> {
  const orphans: string[] = [];

  try {
    const output = await git(['worktree', 'list', '--porcelain'], repoPath);
    const blocks = output.split('\n\n').filter(Boolean);

    for (const block of blocks) {
      const lines = block.split('\n');
      const worktreeLine = lines.find(l => l.startsWith('worktree '));
      const branchLine = lines.find(l => l.startsWith('branch '));

      if (!worktreeLine || !branchLine) continue;

      const wtPath = worktreeLine.replace('worktree ', '');
      const branch = branchLine.replace('branch refs/heads/', '');

      // Cheenoski worktrees use a PID-namespaced pattern
      if (branch.match(/^cheenoski-\d+-/)) {
        const pidMatch = branch.match(/^cheenoski-(\d+)-/);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          if (!isProcessRunning(pid)) {
            orphans.push(wtPath);
          }
        }
      }
    }
  } catch {
    logger.debug('Could not list worktrees for orphan scan');
  }

  return orphans;
}

/** Clean up orphaned worktrees and their associated branches */
export async function cleanOrphanedWorktrees(repoPath: string): Promise<number> {
  const orphans = await scanOrphanedWorktrees(repoPath);
  let cleaned = 0;

  for (const wtPath of orphans) {
    // Extract branch name from the worktree path (more reliable than basename)
    let branchName = basename(wtPath);

    try {
      // First, try to get the actual branch name from git
      try {
        const output = await git(['worktree', 'list', '--porcelain'], repoPath);
        const blocks = output.split('\n\n');
        for (const block of blocks) {
          const lines = block.split('\n');
          const wtLine = lines.find(l => l.startsWith('worktree ') && l.includes(wtPath));
          if (wtLine) {
            const branchLine = lines.find(l => l.startsWith('branch '));
            if (branchLine) {
              branchName = branchLine.replace('branch refs/heads/', '');
            }
            break;
          }
        }
      } catch { /* use basename fallback */ }

      await git(['worktree', 'remove', '--force', wtPath], repoPath);
      cleaned++;
      logger.debug(`Cleaned orphaned worktree: ${wtPath}`);

      // Also delete the associated branch to prevent branch accumulation
      try {
        await git(['branch', '-D', branchName], repoPath);
        logger.debug(`Deleted orphaned branch: ${branchName}`);
      } catch {
        // Branch may already be gone or named differently — not critical
        logger.debug(`Could not delete branch ${branchName} (may already be gone)`);
      }
    } catch (err) {
      logger.warn(`Failed to clean orphaned worktree ${wtPath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return cleaned;
}

/** Post-run audit: check for leftover worktrees, branches, processes */
export async function postRunAudit(repoPath: string, baseBranch: string, startBranch?: string): Promise<string[]> {
  const warnings: string[] = [];

  // Check for leftover worktrees
  const orphans = await scanOrphanedWorktrees(repoPath);
  if (orphans.length > 0) {
    warnings.push(`${orphans.length} orphaned worktree(s) found: ${orphans.map(o => basename(o)).join(', ')}`);
  }

  // Check we're back on the branch we started on (or baseBranch if not tracked)
  const expectedBranch = startBranch ?? baseBranch;
  try {
    const current = await git(['branch', '--show-current'], repoPath);
    if (current !== expectedBranch) {
      warnings.push(`Expected to be on ${expectedBranch}, but on ${current}`);
    }
  } catch { /* ignore */ }

  // Check for uncommitted stash entries from Cheenoski
  try {
    const stashList = await git(['stash', 'list'], repoPath);
    const cheenoskiStashes = stashList.split('\n').filter(l => l.includes('cheenoski'));
    if (cheenoskiStashes.length > 0) {
      warnings.push(`${cheenoskiStashes.length} Cheenoski stash entries found — consider cleaning up`);
    }
  } catch { /* ignore */ }

  return warnings;
}

/** Check if a process ID is still running */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
