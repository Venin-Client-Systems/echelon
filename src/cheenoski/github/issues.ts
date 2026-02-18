import type { CheenoskiIssue } from '../types.js';
import { logger } from '../../lib/logger.js';
import { githubClient } from '../../lib/github-client.js';

/** Fetch open issues by label from a repo */
export async function fetchIssuesByLabel(
  repo: string,
  label: string,
  limit = 50,
): Promise<CheenoskiIssue[]> {
  try {
    const { stdout } = await githubClient.exec([
      'issue', 'list',
      '--repo', repo,
      '--label', label,
      '--state', 'open',
      '--limit', String(limit),
      '--json', 'number,title,body,labels,state,assignees,url',
    ]);

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
      await githubClient.exec([
        'issue', 'comment', String(issueNumber),
        '--repo', repo,
        '--body', comment,
      ]);
    } catch (err) {
      logger.warn(`Failed to comment on issue #${issueNumber}: ${err}`);
    }
  }

  await githubClient.exec([
    'issue', 'close', String(issueNumber),
    '--repo', repo,
  ]);

  logger.info(`Closed issue #${issueNumber}`);
}

/** Add a comment to an issue */
export async function commentOnIssue(
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await githubClient.exec([
    'issue', 'comment', String(issueNumber),
    '--repo', repo,
    '--body', body,
  ]);
}

/** Add a label to an issue */
export async function addLabel(
  repo: string,
  issueNumber: number,
  label: string,
): Promise<void> {
  await githubClient.exec([
    'issue', 'edit', String(issueNumber),
    '--repo', repo,
    '--add-label', label,
  ]);
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
    const { stdout } = await githubClient.exec([
      'api', `repos/${repo}/issues/${issueNumber}/events`,
      '--jq', '[.[] | select(.event == "closed" or .event == "reopened")] | length',
    ]);

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
