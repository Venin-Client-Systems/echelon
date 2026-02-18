import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../lib/logger.js';
import type { IssuePayload } from '../lib/types.js';

const execFileAsync = promisify(execFile);

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
      await execFileAsync('gh', ['label', 'create', label, '--repo', repo, '--force'], {
        encoding: 'utf-8',
      });
    } catch {
      // Label may already exist or gh may not support --force; ignore
    }
  }
}

/**
 * Create GitHub issues via the `gh` CLI.
 * Returns an array of successfully created issues with their numbers.
 * Continues creating remaining issues even if one fails.
 */
export async function createIssues(
  issues: IssuePayload[],
  repo: string,
): Promise<CreatedIssue[]> {
  if (!isValidRepo(repo)) {
    throw new Error(`Invalid repo format: "${repo}". Expected owner/repo`);
  }

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

      const { stdout } = await execFileAsync('gh', args, { encoding: 'utf-8' });
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
