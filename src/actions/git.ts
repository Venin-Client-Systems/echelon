import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../lib/logger.js';

const execFileAsync = promisify(execFile);

/** Validate branch name against git naming rules */
function isValidBranchName(name: string): boolean {
  // Git branch name restrictions
  if (!name || name.startsWith('.') || name.endsWith('.') || name.endsWith('.lock')) return false;
  if (name.includes('..') || name.includes('~') || name.includes('^') || name.includes(':')) return false;
  if (name.includes('\\') || name.includes(' ') || name.includes('?') || name.includes('*') || name.includes('[')) return false;
  if (/[\x00-\x1f\x7f]/.test(name)) return false;
  return true;
}

/**
 * Create a new git branch WITHOUT switching to it.
 */
export async function createBranch(
  branchName: string,
  repoPath: string,
  fromRef?: string,
): Promise<void> {
  if (!isValidBranchName(branchName)) {
    throw new Error(`Invalid branch name: "${branchName}"`);
  }

  // Validate fromRef if provided to prevent injection
  if (fromRef && !isValidBranchName(fromRef)) {
    throw new Error(`Invalid fromRef: "${fromRef}"`);
  }

  try {
    const args = ['branch', branchName];
    if (fromRef) args.push(fromRef);
    await execFileAsync('git', args, { cwd: repoPath, encoding: 'utf-8' });
    logger.info(`Created branch: ${branchName}${fromRef ? ` from ${fromRef}` : ''}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create branch ${branchName}: ${msg}`);
  }
}

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: repoPath,
      encoding: 'utf-8',
    });
    return stdout.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to get current branch: ${msg}`);
  }
}

/**
 * Check if working tree is clean.
 */
export async function isClean(repoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: repoPath,
      encoding: 'utf-8',
    });
    return stdout.trim().length === 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to check git status: ${msg}`);
  }
}
