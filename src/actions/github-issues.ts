import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../lib/logger.js';
import type { IssuePayload } from '../lib/types.js';

const execFileAsync = promisify(execFile);

/**
 * Create GitHub issues via the `gh` CLI.
 * Returns an array of issue numbers.
 */
export async function createIssues(
  issues: IssuePayload[],
  repo: string,
): Promise<number[]> {
  const numbers: number[] = [];

  for (const issue of issues) {
    try {
      const args = [
        'issue', 'create',
        '--repo', repo,
        '--title', issue.title,
        '--body', issue.body,
      ];

      if (issue.labels.length > 0) {
        args.push('--label', issue.labels.join(','));
      }

      if (issue.assignee) {
        args.push('--assignee', issue.assignee);
      }

      const { stdout } = await execFileAsync('gh', args, { encoding: 'utf-8' });
      const output = stdout.trim();

      // gh issue create outputs a URL like https://github.com/owner/repo/issues/42
      const match = output.match(/\/issues\/(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        numbers.push(num);
        logger.info(`Created issue #${num}: ${issue.title}`);
      } else {
        logger.warn('Could not parse issue number from gh output', { output });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to create issue: ${issue.title}`, { error: msg });
      throw new Error(`gh issue create failed: ${msg}`);
    }
  }

  return numbers;
}

/**
 * Close a GitHub issue.
 */
export async function closeIssue(issueNumber: number, repo: string): Promise<void> {
  try {
    await execFileAsync('gh', ['issue', 'close', String(issueNumber), '--repo', repo], {
      encoding: 'utf-8',
    });
    logger.info(`Closed issue #${issueNumber}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to close issue #${issueNumber}`, { error: msg });
    throw new Error(`gh issue close failed: ${msg}`);
  }
}
