import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../lib/logger.js';

const execFileAsync = promisify(execFile);

/**
 * Request a PR review by fetching PR details.
 */
export async function requestReview(
  prNumber: number,
  repo: string,
  focus?: string,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('gh', [
      'pr', 'view', String(prNumber),
      '--repo', repo,
      '--json', 'title,state,additions,deletions,files',
    ], { encoding: 'utf-8' });

    const pr = JSON.parse(stdout);
    logger.info(`PR #${prNumber}: ${pr.title} (${pr.state})`, {
      additions: pr.additions,
      deletions: pr.deletions,
      files: pr.files?.length ?? 0,
    });

    const reviewNote = focus
      ? `Review requested with focus on: ${focus}`
      : 'Review requested';

    return `${reviewNote} — PR #${prNumber}: ${pr.title} (+${pr.additions}/-${pr.deletions}, ${pr.files?.length ?? 0} files)`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to review PR #${prNumber}`, { error: msg });
    throw new Error(`PR review failed: ${msg}`);
  }
}
