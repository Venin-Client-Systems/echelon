import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../lib/logger.js';

const execFileAsync = promisify(execFile);

/** Validate repo format (owner/repo) */
function isValidRepo(repo: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo);
}

/**
 * Request a PR review by fetching PR details.
 */
export async function requestReview(
  prNumber: number,
  repo: string,
  focus?: string,
): Promise<string> {
  if (!isValidRepo(repo)) {
    throw new Error(`Invalid repo format: "${repo}". Expected owner/repo`);
  }

  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`Invalid PR number: ${prNumber}`);
  }

  try {
    const { stdout } = await execFileAsync('gh', [
      'pr', 'view', String(prNumber),
      '--repo', repo,
      '--json', 'title,state,additions,deletions,files',
    ], { encoding: 'utf-8' });

    let pr: unknown;
    try {
      pr = JSON.parse(stdout);
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      throw new Error(`Failed to parse PR JSON: ${msg}`);
    }

    // Validate PR object structure
    if (!pr || typeof pr !== 'object' || !('title' in pr) || typeof pr.title !== 'string') {
      throw new Error('Invalid PR data structure from gh CLI');
    }

    const prData = pr as { title: string; state?: string; additions?: number; deletions?: number; files?: unknown[] };
    logger.info(`PR #${prNumber}: ${prData.title} (${prData.state ?? 'unknown'})`, {
      additions: prData.additions ?? 0,
      deletions: prData.deletions ?? 0,
      files: prData.files?.length ?? 0,
    });

    const reviewNote = focus
      ? `Review requested with focus on: ${focus}`
      : 'Review requested';

    return `${reviewNote} — PR #${prNumber}: ${prData.title} (+${prData.additions ?? 0}/-${prData.deletions ?? 0}, ${prData.files?.length ?? 0} files)`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to review PR #${prNumber}`, { error: msg });
    throw new Error(`PR review failed: ${msg}`);
  }
}
