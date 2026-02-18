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
 *
 * @param repoPath - Path to the main repository
 * @param featureBranch - Name of the feature branch to merge
 * @param baseBranch - Name of the base branch to merge into
 * @param issueNumber - Issue number for commit message
 * @param worktreePath - Path to the worktree (used for rebase; falls back to repoPath)
 */
export async function mergeBranch(
  repoPath: string,
  featureBranch: string,
  baseBranch: string,
  issueNumber: number,
  worktreePath?: string,
): Promise<MergeResult> {
  // 1. Ensure the feature branch is a descendant of base branch.
  //    If base has advanced (e.g. another parallel merge landed), rebase
  //    the feature branch onto the current base so the merge is clean.
  //    IMPORTANT: Rebase in the worktree (where the feature branch is checked out),
  //    NOT in the main repo — that would corrupt the main repo's working tree.
  try {
    await git(['merge-base', '--is-ancestor', baseBranch, featureBranch], repoPath);
  } catch {
    logger.info(`${featureBranch} diverged from ${baseBranch} — rebasing before merge`);

    // Rebase in the worktree where the feature branch is checked out
    const rebaseCwd = worktreePath ?? repoPath;
    try {
      await git(['rebase', baseBranch], rebaseCwd);
    } catch (rebaseErr) {
      // Rebase conflict — abort and report failure
      try { await git(['rebase', '--abort'], rebaseCwd); } catch { /* best effort */ }
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
  // Include PID to ensure unique stash message even if same millisecond
  const stashMessage = `cheenoski-pre-merge-${issueNumber}-${process.pid}-${Date.now()}`;
  const status = await git(['status', '--porcelain'], repoPath);
  if (status.trim().length > 0) {
    try {
      await git(['stash', 'push', '-m', stashMessage], repoPath);
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
  // Note: detached HEAD returns empty string
  const currentBranch = await git(['branch', '--show-current'], repoPath);
  if (currentBranch && currentBranch.length > 0 && currentBranch !== baseBranch) {
    await git(['checkout', baseBranch], repoPath);
  } else if (!currentBranch || currentBranch.length === 0) {
    // Detached HEAD state — just checkout base branch
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
      // List conflicting files BEFORE aborting (diff-filter=U is empty after abort)
      let conflictFiles: string[] = [];
      try {
        const conflictOutput = await git(['diff', '--name-only', '--diff-filter=U'], repoPath);
        conflictFiles = conflictOutput.split('\n').filter(Boolean);
      } catch { /* ignore */ }

      // Now abort the merge
      try { await git(['merge', '--abort'], repoPath); } catch { /* best effort */ }

      return {
        success: false,
        error: `Merge conflict in ${featureBranch}`,
        conflictFiles,
      };
    }

    return { success: false, error: msg };
  } finally {
    // Restore original branch if we switched away (skip if detached HEAD or empty)
    if (currentBranch && currentBranch.length > 0 && currentBranch !== baseBranch) {
      try {
        await git(['checkout', currentBranch], repoPath);
      } catch {
        logger.warn(`Failed to restore branch ${currentBranch} after merge`);
      }
    }

    // Restore stash by matching the unique message (safer than index-based ref)
    if (stashed) {
      try {
        const stashList = await git(['stash', 'list'], repoPath);
        const lines = stashList.split('\n');
        let foundRef = '';
        for (const line of lines) {
          if (line.includes(stashMessage)) {
            const match = line.match(/^(stash@\{\d+\})/);
            if (match) { foundRef = match[1]; break; }
          }
        }
        if (foundRef) {
          await git(['stash', 'pop', foundRef], repoPath);
          logger.debug('Restored stashed changes after merge');
        } else {
          logger.warn(`Could not find stash with message "${stashMessage}" — check git stash list`);
        }
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

  // Check if HEAD has commits beyond the base branch (three-dot diff)
  try {
    const diffStat = await git(['diff', '--stat', `${baseBranch}...HEAD`], worktreePath);
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
