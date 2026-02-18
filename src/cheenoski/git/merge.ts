import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../lib/logger.js';
import { githubClient } from '../../lib/github-client.js';
import { appendToLedger } from './branch-ledger.js';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8' });
  return stdout.trim();
}

export interface MergeResult {
  success: boolean;
  error?: string;
  conflictFiles?: string[];
}

/**
 * Merge a feature branch back into base branch.
 * Verifies ancestor relationship before merging.
 * Restores original branch after merging.
 */
export async function mergeBranch(
  repoPath: string,
  featureBranch: string,
  baseBranch: string,
  issueNumber: number,
): Promise<MergeResult> {
  // 1. Ensure the feature branch is a descendant of base branch.
  //    If base has advanced (e.g. another parallel merge landed), rebase
  //    the feature branch onto the current base so the merge is clean.
  try {
    await git(['merge-base', '--is-ancestor', baseBranch, featureBranch], repoPath);
  } catch {
    logger.info(`${featureBranch} diverged from ${baseBranch} — rebasing before merge`);

    // First checkout the feature branch before rebasing
    try {
      await git(['checkout', featureBranch], repoPath);
    } catch (checkoutErr) {
      const coMsg = checkoutErr instanceof Error ? checkoutErr.message : String(checkoutErr);
      return {
        success: false,
        error: `Failed to checkout ${featureBranch}: ${coMsg}`,
      };
    }

    try {
      await git(['rebase', baseBranch], repoPath);
    } catch (rebaseErr) {
      // Rebase conflict — abort and report failure
      try { await git(['rebase', '--abort'], repoPath); } catch { /* best effort */ }
      const rbMsg = rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr);
      return {
        success: false,
        error: `Rebase conflict rebasing ${featureBranch} onto ${baseBranch}: ${rbMsg}`,
      };
    }
  }

  // 2. Check if feature branch has any commits beyond base
  const diffStat = await git(['diff', '--stat', `${baseBranch}...${featureBranch}`], repoPath);
  if (!diffStat) {
    logger.warn(`No changes in ${featureBranch} relative to ${baseBranch}`);
    return { success: true }; // Nothing to merge
  }

  // 3. Stash any uncommitted changes in the main worktree
  let stashed = false;
  let stashRef = '';
  const status = await git(['status', '--porcelain'], repoPath);
  if (status.length > 0) {
    try {
      await git(['stash', 'push', '-m', `cheenoski-pre-merge-${issueNumber}`], repoPath);
      // Get the stash ref for safer restoration
      const stashList = await git(['stash', 'list'], repoPath);
      const stashMatch = stashList.match(/^(stash@\{\d+\})/);
      stashRef = stashMatch ? stashMatch[1] : 'stash@{0}';
      stashed = true;
      logger.debug('Stashed uncommitted changes before merge');
    } catch (stashErr) {
      logger.warn(`Failed to stash changes: ${stashErr instanceof Error ? stashErr.message : stashErr}`);
      return {
        success: false,
        error: `Cannot merge with dirty working tree and stash failed`,
      };
    }
  }

  // 4. Save current branch so we can restore it after merging
  const currentBranch = await git(['branch', '--show-current'], repoPath);
  if (currentBranch !== baseBranch) {
    await git(['checkout', baseBranch], repoPath);
  }

  try {
    // 5. Perform the merge
    await git(
      ['merge', '--no-ff', '-m', `Merge ${featureBranch} (issue #${issueNumber})`, featureBranch],
      repoPath,
    );

    appendToLedger({
      action: 'merge',
      branch: featureBranch,
      worktree: null,
      issueNumber,
      detail: `merged into ${baseBranch}`,
    });

    logger.info(`Merged ${featureBranch} into ${baseBranch}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Check for merge conflicts
    if (msg.includes('CONFLICT') || msg.includes('Automatic merge failed')) {
      // Abort the merge
      try { await git(['merge', '--abort'], repoPath); } catch { /* best effort */ }

      // List conflicting files
      let conflictFiles: string[] = [];
      try {
        const conflictOutput = await git(['diff', '--name-only', '--diff-filter=U'], repoPath);
        conflictFiles = conflictOutput.split('\n').filter(Boolean);
      } catch { /* ignore */ }

      return {
        success: false,
        error: `Merge conflict in ${featureBranch}`,
        conflictFiles,
      };
    }

    return { success: false, error: msg };
  } finally {
    // Restore original branch if we switched away
    if (currentBranch && currentBranch !== baseBranch) {
      try {
        await git(['checkout', currentBranch], repoPath);
      } catch {
        logger.warn(`Failed to restore branch ${currentBranch} after merge`);
      }
    }

    // Restore stash if we stashed
    if (stashed) {
      try {
        // Use the stash ref if we have it, otherwise fall back to stash@{0}
        const ref = stashRef || 'stash@{0}';
        await git(['stash', 'pop', ref], repoPath);
        logger.debug('Restored stashed changes after merge');
      } catch (popErr) {
        logger.warn(`Failed to restore stash after merge: ${popErr instanceof Error ? popErr.message : popErr} — check git stash list`);
      }
    }
  }
}

/**
 * Verify a merge was successful by checking that the merge commit
 * contains the expected file changes.
 */
export async function verifyMerge(
  repoPath: string,
  featureBranch: string,
  baseBranch: string,
): Promise<boolean> {
  try {
    // The feature branch should now be an ancestor of base
    await git(['merge-base', '--is-ancestor', featureBranch, baseBranch], repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a worktree has any uncommitted changes or new commits.
 * Returns true if there are changes to merge.
 */
export async function hasChanges(worktreePath: string, baseBranch: string): Promise<boolean> {
  // Check for uncommitted changes
  const status = await git(['status', '--porcelain'], worktreePath);
  if (status.length > 0) return true;

  // Check if HEAD differs from base branch
  try {
    const diffStat = await git(['diff', '--stat', baseBranch], worktreePath);
    return diffStat.length > 0;
  } catch {
    return false;
  }
}

/**
 * Create a pull request for a feature branch using gh CLI.
 */
export async function createPullRequest(
  repo: string,
  featureBranch: string,
  baseBranch: string,
  title: string,
  body: string,
  draft: boolean,
  repoPath?: string,
): Promise<{ number: number; url: string }> {
  // Push the branch first (cwd must be in the git repo)
  try {
    await execFileAsync('git', [
      'push', '-u', 'origin', featureBranch,
    ], { encoding: 'utf-8', ...(repoPath ? { cwd: repoPath } : {}) });
  } catch (pushErr) {
    throw new Error(`Failed to push branch ${featureBranch}: ${pushErr instanceof Error ? pushErr.message : pushErr}`);
  }

  const args = [
    'pr', 'create',
    '--repo', repo,
    '--head', featureBranch,
    '--base', baseBranch,
    '--title', title,
    '--body', body,
  ];
  if (draft) args.push('--draft');

  try {
    const { stdout } = await githubClient.exec(args);
    const url = stdout.trim();
    const match = url.match(/\/pull\/(\d+)/);
    const number = match ? parseInt(match[1], 10) : 0;

    logger.info(`PR created: ${url}`);
    return { number, url };
  } catch (ghErr) {
    throw new Error(`Failed to create PR: ${ghErr instanceof Error ? ghErr.message : ghErr}`);
  }
}
