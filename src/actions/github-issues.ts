import { logger } from '../lib/logger.js';
import { githubClient } from '../lib/github-client.js';
import type { IssuePayload } from '../lib/types.js';

export interface CreatedIssue {
  number: number;
  title: string;
  labels: string[];
}

/** Validate repo format (owner/repo) */
function isValidRepo(repo: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo);
}

/** Sanitize string for safe use in CLI args */
function sanitizeString(str: string): string {
  // Remove null bytes and control characters
  return str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Ensure labels exist on the repo — create any that are missing.
 */
async function ensureLabels(labels: string[], repo: string): Promise<void> {
  for (const label of labels) {
    try {
      await githubClient.exec(['label', 'create', label, '--repo', repo, '--force']);
    } catch {
      // Label may already exist or gh may not support --force; ignore
    }
  }
}

/** Fetch open issue titles from the repo to avoid creating duplicates */
async function fetchOpenIssueTitles(repo: string): Promise<Set<string>> {
  try {
    const { stdout } = await githubClient.exec([
      'issue', 'list', '--repo', repo, '--state', 'open',
      '--limit', '200', '--json', 'title',
    ]);
    const raw = JSON.parse(stdout) as { title: string }[];
    return new Set(raw.map(i => i.title.toLowerCase().trim()));
  } catch {
    return new Set();
  }
}

/**
 * Create GitHub issues via the `gh` CLI.
 * Returns an array of successfully created issues with their numbers.
 * Skips issues whose titles match existing open issues (deduplication).
 * Continues creating remaining issues even if one fails.
 */
export async function createIssues(
  issues: IssuePayload[],
  repo: string,
): Promise<CreatedIssue[]> {
  if (!isValidRepo(repo)) {
    throw new Error(`Invalid repo format: "${repo}". Expected owner/repo`);
  }

  // Fetch existing open issues for deduplication
  const existingTitles = await fetchOpenIssueTitles(repo);

  // Collect all unique labels and ensure they exist
  const allLabels = new Set<string>();
  for (const issue of issues) {
    for (const label of issue.labels) {
      allLabels.add(sanitizeString(label));
    }
  }
  if (allLabels.size > 0) {
    await ensureLabels([...allLabels], repo);
  }

  const created: CreatedIssue[] = [];

  for (const issue of issues) {
    try {
      // Sanitize all user inputs
      const title = sanitizeString(issue.title);
      const body = sanitizeString(issue.body);
      const labels = issue.labels.map(sanitizeString);
      const assignee = issue.assignee ? sanitizeString(issue.assignee) : undefined;

      if (!title.trim()) {
        logger.warn('Skipping issue with empty title');
        continue;
      }

      // Dedup: skip if an open issue with the same title already exists
      if (existingTitles.has(title.toLowerCase().trim())) {
        logger.info(`Skipping duplicate issue: ${title}`);
        continue;
      }

      const args = [
        'issue', 'create',
        '--repo', repo,
        '--title', title,
        '--body', body,
      ];

      if (labels.length > 0) {
        args.push('--label', labels.join(','));
      }

      if (assignee) {
        args.push('--assignee', assignee);
      }

      const { stdout } = await githubClient.exec(args);
      const output = stdout.trim();

      // gh issue create outputs a URL like https://github.com/owner/repo/issues/42
      const match = output.match(/\/issues\/(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        created.push({ number: num, title: issue.title, labels: issue.labels });
        logger.info(`Created issue #${num}: ${issue.title}`);
      } else {
        logger.warn('Could not parse issue number from gh output', { output });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to create issue: ${issue.title}`, { error: msg });
      // Continue with remaining issues instead of aborting
    }
  }

  return created;
}

/**
 * Close a GitHub issue.
 */
export async function closeIssue(issueNumber: number, repo: string): Promise<void> {
  if (!isValidRepo(repo)) {
    throw new Error(`Invalid repo format: "${repo}". Expected owner/repo`);
  }

  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`Invalid issue number: ${issueNumber}`);
  }

  try {
    await githubClient.exec(['issue', 'close', String(issueNumber), '--repo', repo]);
    logger.info(`Closed issue #${issueNumber}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to close issue #${issueNumber}`, { error: msg });
    throw new Error(`gh issue close failed: ${msg}`);
  }
}
