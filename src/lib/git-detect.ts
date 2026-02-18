import { execFileSync } from 'node:child_process';

export interface GitRepoInfo {
  repo: string;
  path: string;
  baseBranch: string;
}

export function detectGitRepo(): GitRepoInfo | null {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const match = remote.match(/[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
    const repo = match ? match[1] : '';

    const path = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const baseBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    return { repo, path, baseBranch };
  } catch {
    return null;
  }
}
