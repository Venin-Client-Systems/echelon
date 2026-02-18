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

    // Detect the default branch (main/master), NOT the current branch.
    // symbolic-ref HEAD returns the CURRENT branch, which is wrong for baseBranch.
    let baseBranch = 'main'; // sensible default
    try {
      // Try refs/remotes/origin/HEAD which points to the default branch
      const defaultRef = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      // refs/remotes/origin/HEAD -> refs/remotes/origin/main
      baseBranch = defaultRef.replace('refs/remotes/origin/', '');
    } catch {
      // origin/HEAD not set — try common default branch names
      try {
        execFileSync('git', ['rev-parse', '--verify', 'refs/heads/main'], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        baseBranch = 'main';
      } catch {
        try {
          execFileSync('git', ['rev-parse', '--verify', 'refs/heads/master'], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          baseBranch = 'master';
        } catch {
          // Fall back to current branch as last resort
          baseBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
        }
      }
    }

    if (!repo) return null;

    return { repo, path, baseBranch };
  } catch {
    return null;
  }
}
