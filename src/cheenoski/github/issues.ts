import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CheenoskiIssue } from '../types.js';
import { logger } from '../../lib/logger.js';

const execFileAsync = promisify(execFile);

/** Retry GitHub CLI commands with exponential backoff for rate limits */
async function withGitHubRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries = 3,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(errorMsg);

      // Check if it's a rate limit error
      const isRateLimit = errorMsg.includes('rate limit') ||
                          errorMsg.includes('403') ||
                          errorMsg.includes('429');

      if (isRateLimit && attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 16000); // Cap at 16s
        logger.warn(`${operationName}: rate limit hit, retrying in ${delayMs}ms`, {
          attempt,
          maxRetries,
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else if (attempt < maxRetries) {
        // Other errors - shorter delay
        const delayMs = 500;
        logger.warn(`${operationName}: failed, retrying`, { attempt, error: errorMsg });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

/** Fetch open issues by label from a repo */
export async function fetchIssuesByLabel(
  repo: string,
  label: string,
  limit = 50,
): Promise<CheenoskiIssue[]> {
  try {
    return await withGitHubRetry(async () => {
      const { stdout } = await execFileAsync('gh', [
        'issue', 'list',
        '--repo', repo,
        '--label', label,
        '--state', 'open',
        '--limit', String(limit),
        '--json', 'number,title,body,labels,state,assignees,url',
      ], { encoding: 'utf-8' });

      const raw = JSON.parse(stdout);
      return raw.map((issue: any) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body,
        labels: (issue.labels ?? []).map((l: any) => l.name),
        state: issue.state.toLowerCase(),
        assignees: issue.assignees.map((a: any) => a.login),
        url: issue.url,
      }));
    }, `fetch issues (${label})`);
  } catch (err) {
    logger.warn(`Failed to fetch issues for label "${label}" in ${repo}: ${err}`);
    return [];
  }
}

/** Close an issue with a comment */
export async function closeIssue(
  repo: string,
  issueNumber: number,
  comment?: string,
): Promise<void> {
  if (comment) {
    try {
      await execFileAsync('gh', [
        'issue', 'comment', String(issueNumber),
        '--repo', repo,
        '--body', comment,
      ], { encoding: 'utf-8' });
    } catch (err) {
      logger.warn(`Failed to comment on issue #${issueNumber}: ${err}`);
    }
  }

  await execFileAsync('gh', [
    'issue', 'close', String(issueNumber),
    '--repo', repo,
  ], { encoding: 'utf-8' });

  logger.info(`Closed issue #${issueNumber}`);
}

/** Add a comment to an issue */
export async function commentOnIssue(
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await execFileAsync('gh', [
    'issue', 'comment', String(issueNumber),
    '--repo', repo,
    '--body', body,
  ], { encoding: 'utf-8' });
}

/** Add a label to an issue */
export async function addLabel(
  repo: string,
  issueNumber: number,
  label: string,
): Promise<void> {
  await execFileAsync('gh', [
    'issue', 'edit', String(issueNumber),
    '--repo', repo,
    '--add-label', label,
  ], { encoding: 'utf-8' });
}

/** Check if an issue is already being worked on (has "in-progress" label or assignee) */
export function isIssueInProgress(issue: CheenoskiIssue): boolean {
  return (
    issue.assignees.length > 0 ||
    issue.labels.includes('in-progress') ||
    issue.labels.includes('wip')
  );
}

/**
 * Detect loop: issue was closed then reopened (might indicate repeated failure).
 * We check by looking at the issue's event timeline for close/reopen cycles.
 */
export async function detectLoop(
  repo: string,
  issueNumber: number,
  maxCycles = 2,
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('gh', [
      'api', `repos/${repo}/issues/${issueNumber}/events`,
      '--jq', '[.[] | select(.event == "closed" or .event == "reopened")] | length',
    ], { encoding: 'utf-8' });

    const eventCount = parseInt(stdout.trim(), 10);
    // Each close+reopen cycle = 2 events. If we see >= maxCycles*2, it's a loop.
    return eventCount >= maxCycles * 2;
  } catch {
    return false;
  }
}

/**
 * Block an issue by adding a "blocked" label and commenting.
 */
export async function blockIssue(
  repo: string,
  issueNumber: number,
  reason: string,
): Promise<void> {
  await addLabel(repo, issueNumber, 'blocked');
  await commentOnIssue(repo, issueNumber,
    `Blocked by Cheenoski: ${reason}\n\nThis issue needs manual intervention.`
  );
  logger.warn(`Blocked issue #${issueNumber}: ${reason}`);
}
