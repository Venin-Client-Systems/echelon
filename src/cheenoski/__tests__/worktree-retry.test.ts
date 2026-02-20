import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import {
  createWorktree,
  cleanupForRetry,
  pruneWorktreeMetadata,
  listWorktrees,
  worktreeBranchName,
  worktreePath,
  removeWorktree,
} from '../git/worktree.js';
import { logger } from '../../lib/logger.js';

// Mock logger to prevent console output during tests
vi.mock('../../lib/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock branch ledger to avoid filesystem writes during tests
vi.mock('../git/branch-ledger.js', () => ({
  appendToLedger: vi.fn(),
}));

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8' });
  return stdout.trim();
}

/**
 * Create a temporary git repository for testing.
 * Includes an initial commit on main branch.
 */
async function createTestRepo(): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'worktree-test-'));
  await git(['init', '-b', 'main'], tmpDir);
  await git(['config', 'user.name', 'Test'], tmpDir);
  await git(['config', 'user.email', 'test@test.com'], tmpDir);

  // Create initial commit
  await writeFile(join(tmpDir, 'README.md'), '# Test\n');
  await git(['add', '.'], tmpDir);
  await git(['commit', '-m', 'Initial commit'], tmpDir);

  return tmpDir;
}

/**
 * Create a conflicting commit on the base branch to simulate merge conflicts.
 */
async function createConflictingCommit(repoPath: string, branch: string, file: string): Promise<void> {
  await git(['checkout', branch], repoPath);
  await writeFile(join(repoPath, file), 'Conflicting content\n');
  await git(['add', file], repoPath);
  await git(['commit', '-m', 'Create conflict'], repoPath);
}

/**
 * Manually create orphaned worktree metadata without creating the actual worktree.
 * Simulates interrupted cleanup or crash scenarios.
 */
async function createOrphanedMetadata(repoPath: string, branchName: string): Promise<void> {
  const worktreeMetadataPath = join(repoPath, '.git', 'worktrees', branchName);
  await mkdir(worktreeMetadataPath, { recursive: true });
  await writeFile(join(worktreeMetadataPath, 'gitdir'), '/fake/path');
}

/**
 * Get list of all worktree references from git.
 */
async function getWorktreeList(repoPath: string): Promise<string[]> {
  try {
    const output = await git(['worktree', 'list', '--porcelain'], repoPath);
    return output.split('\n\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('Worktree Retry Integration Tests', () => {
  let testRepo: string;

  beforeEach(async () => {
    testRepo = await createTestRepo();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up all test worktrees
    try {
      const worktrees = await listWorktrees(testRepo);
      for (const wt of worktrees) {
        await removeWorktree(testRepo, wt.path, wt.branch, wt.issueNumber, true);
      }
    } catch {
      // Best effort cleanup
    }

    // Remove test repo
    if (testRepo && existsSync(testRepo)) {
      await rm(testRepo, { recursive: true, force: true });
    }
  });

  describe('Happy path retry', () => {
    it('should cleanup and retry successfully after merge conflict', async () => {
      const issueNumber = 42;
      const slug = 'test-feature';
      const branch = worktreeBranchName(issueNumber, slug);

      // Step 1: Create initial worktree
      const wt1 = await createWorktree(testRepo, 'main', issueNumber, slug);
      expect(wt1.branch).toBe(branch);
      expect(existsSync(wt1.path)).toBe(true);

      // Step 2: Simulate merge conflict by creating conflicting commit
      await createConflictingCommit(testRepo, 'main', 'README.md');

      // Step 3: Simulate task failure - remove worktree directory
      // In real scenario, the directory might be corrupted or removed after a crash
      await rm(wt1.path, { recursive: true, force: true });

      // Step 4: Cleanup the failed worktree metadata
      await cleanupForRetry(testRepo, wt1.path, wt1.branch);

      // Step 5: Verify cleanup was successful
      expect(existsSync(wt1.path)).toBe(false);
      const worktrees = await getWorktreeList(testRepo);
      const hasOrphanedRef = worktrees.some(wt => wt.includes(branch));
      expect(hasOrphanedRef).toBe(false);

      // Step 6: Retry with new worktree (should succeed)
      const wt2 = await createWorktree(testRepo, 'main', issueNumber, slug);
      expect(wt2.branch).toBe(branch);
      expect(existsSync(wt2.path)).toBe(true);
      // Note: Path may be the same since PID namespace is consistent within same test

      // Cleanup for test
      await removeWorktree(testRepo, wt2.path, wt2.branch, issueNumber, true);
    });
  });

  describe('Concurrent retries', () => {
    it('should handle two slots failing simultaneously without worktree conflicts', async () => {
      const issue1 = 101;
      const issue2 = 102;
      const slug1 = 'feature-a';
      const slug2 = 'feature-b';

      // Create two worktrees concurrently
      const [wt1, wt2] = await Promise.all([
        createWorktree(testRepo, 'main', issue1, slug1),
        createWorktree(testRepo, 'main', issue2, slug2),
      ]);

      expect(existsSync(wt1.path)).toBe(true);
      expect(existsSync(wt2.path)).toBe(true);
      expect(wt1.branch).not.toBe(wt2.branch);

      // Simulate both failing and cleaning up concurrently
      await Promise.all([
        cleanupForRetry(testRepo, wt1.path, wt1.branch),
        cleanupForRetry(testRepo, wt2.path, wt2.branch),
      ]);

      // Verify both are cleaned up
      expect(existsSync(wt1.path)).toBe(false);
      expect(existsSync(wt2.path)).toBe(false);

      // Retry both concurrently
      const [wt1Retry, wt2Retry] = await Promise.all([
        createWorktree(testRepo, 'main', issue1, slug1),
        createWorktree(testRepo, 'main', issue2, slug2),
      ]);

      expect(existsSync(wt1Retry.path)).toBe(true);
      expect(existsSync(wt2Retry.path)).toBe(true);
      expect(wt1Retry.branch).toBe(wt1.branch);
      expect(wt2Retry.branch).toBe(wt2.branch);

      // Cleanup
      await Promise.all([
        removeWorktree(testRepo, wt1Retry.path, wt1Retry.branch, issue1, true),
        removeWorktree(testRepo, wt2Retry.path, wt2Retry.branch, issue2, true),
      ]);
    });
  });

  describe('Interrupted cleanup', () => {
    it('should succeed on retry even if branch delete failed but directory removed', async () => {
      const issueNumber = 50;
      const slug = 'interrupted-test';
      const branch = worktreeBranchName(issueNumber, slug);

      // Create worktree
      const wt = await createWorktree(testRepo, 'main', issueNumber, slug);
      expect(existsSync(wt.path)).toBe(true);

      // Simulate partial cleanup: remove directory but leave branch
      await rm(wt.path, { recursive: true, force: true });
      await pruneWorktreeMetadata(testRepo);
      // Note: branch still exists

      // Verify branch exists
      try {
        await git(['rev-parse', '--verify', branch], testRepo);
        // Branch exists - expected
      } catch {
        throw new Error('Branch should still exist for this test');
      }

      // Now call full cleanup (should be idempotent)
      await cleanupForRetry(testRepo, wt.path, branch);

      // Retry should succeed
      const wtRetry = await createWorktree(testRepo, 'main', issueNumber, slug);
      expect(existsSync(wtRetry.path)).toBe(true);
      expect(wtRetry.branch).toBe(branch);

      // Cleanup
      await removeWorktree(testRepo, wtRetry.path, wtRetry.branch, issueNumber, true);
    });
  });

  describe('Orphaned worktree detection', () => {
    it('should detect and clean orphaned worktree metadata before creating new worktree', async () => {
      const issueNumber = 60;
      const slug = 'orphaned-test';
      const branch = worktreeBranchName(issueNumber, slug);

      // Manually create orphaned metadata
      await createOrphanedMetadata(testRepo, branch);

      // Verify metadata exists
      const metadataPath = join(testRepo, '.git', 'worktrees', branch);
      expect(existsSync(metadataPath)).toBe(true);

      // createWorktree should detect and auto-clean
      const wt = await createWorktree(testRepo, 'main', issueNumber, slug);
      expect(existsSync(wt.path)).toBe(true);
      expect(wt.branch).toBe(branch);

      // Verify logger was called about orphan cleanup
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Detected orphaned worktree metadata'),
        expect.objectContaining({ branch }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Auto-cleanup successful'),
      );

      // Cleanup
      await removeWorktree(testRepo, wt.path, wt.branch, issueNumber, true);
    });

    it('should detect existing worktree reference via worktree list and clean it', async () => {
      const issueNumber = 61;
      const slug = 'existing-ref-test';
      const branch = worktreeBranchName(issueNumber, slug);

      // Create a worktree
      const wt1 = await createWorktree(testRepo, 'main', issueNumber, slug);
      expect(existsSync(wt1.path)).toBe(true);

      // Manually remove the directory but leave git metadata (simulates crash)
      await rm(wt1.path, { recursive: true, force: true });

      // Verify worktree reference still exists in git
      const worktrees = await getWorktreeList(testRepo);
      const hasRef = worktrees.some(wt => wt.includes(branch));
      expect(hasRef).toBe(true);

      // createWorktree should detect via worktree list check
      const wt2 = await createWorktree(testRepo, 'main', issueNumber, slug);
      expect(existsSync(wt2.path)).toBe(true);
      expect(wt2.branch).toBe(branch);

      // Verify cleanup was triggered
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Detected existing worktree reference'),
      );

      // Cleanup
      await removeWorktree(testRepo, wt2.path, wt2.branch, issueNumber, true);
    });
  });

  describe('Idempotency', () => {
    it('should handle multiple cleanup calls on same worktree without errors', async () => {
      const issueNumber = 70;
      const slug = 'idempotent-test';
      const branch = worktreeBranchName(issueNumber, slug);

      // Create worktree
      const wt = await createWorktree(testRepo, 'main', issueNumber, slug);
      expect(existsSync(wt.path)).toBe(true);

      // Call cleanup multiple times
      await cleanupForRetry(testRepo, wt.path, branch);
      await cleanupForRetry(testRepo, wt.path, branch);
      await cleanupForRetry(testRepo, wt.path, branch);

      // Should not throw errors
      expect(existsSync(wt.path)).toBe(false);

      // Verify no lingering references
      const worktrees = await getWorktreeList(testRepo);
      const hasRef = worktrees.some(wt => wt.includes(branch));
      expect(hasRef).toBe(false);

      // Retry should still work
      const wtRetry = await createWorktree(testRepo, 'main', issueNumber, slug);
      expect(existsSync(wtRetry.path)).toBe(true);

      // Cleanup
      await removeWorktree(testRepo, wtRetry.path, wtRetry.branch, issueNumber, true);
    });
  });

  describe('Edge case - no worktree path', () => {
    it('should handle cleanup when worktreePath is null gracefully', async () => {
      const branch = worktreeBranchName(80, 'null-path-test');

      // Call cleanup with null path (simulates failure before worktree creation)
      await expect(cleanupForRetry(testRepo, null, branch)).resolves.not.toThrow();

      // Should only attempt to clean branch and metadata, not directory
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Branch deletion skipped'),
      );
    });
  });

  describe('Verification - no orphaned worktrees after test suite', () => {
    it('should leave no orphaned worktrees after completing all tests', async () => {
      // This test serves as final verification
      // Create multiple worktrees
      const worktrees = await Promise.all([
        createWorktree(testRepo, 'main', 91, 'verify-1'),
        createWorktree(testRepo, 'main', 92, 'verify-2'),
        createWorktree(testRepo, 'main', 93, 'verify-3'),
      ]);

      // Simulate directories being removed (like after a crash)
      await Promise.all(
        worktrees.map(wt => rm(wt.path, { recursive: true, force: true }))
      );

      // Clean them all up
      await Promise.all(
        worktrees.map(wt => cleanupForRetry(testRepo, wt.path, wt.branch))
      );

      // Verify git worktree list shows only the main repo
      const output = await git(['worktree', 'list', '--porcelain'], testRepo);
      const blocks = output.split('\n\n').filter(Boolean);

      // Should only have the main worktree (the repo itself)
      expect(blocks.length).toBe(1);
      expect(blocks[0]).toContain('worktree');
      expect(blocks[0]).not.toContain('cheenoski-');
    });
  });

  describe('Branch name and path generation', () => {
    it('should generate PID-namespaced branch names', () => {
      const branch = worktreeBranchName(123, 'my-feature');
      expect(branch).toMatch(/^cheenoski-\d+-123-my-feature$/);
      expect(branch).toContain(String(process.pid));
    });

    it('should sanitize slugs with unsafe characters', () => {
      const branch = worktreeBranchName(456, 'feat/with spaces & symbols!');
      expect(branch).toMatch(/^cheenoski-\d+-456-feat-with-spaces---symbols-$/);
      expect(branch).not.toContain('/');
      expect(branch).not.toContain(' ');
      expect(branch).not.toContain('&');
    });

    it('should generate temp-adjacent worktree paths', () => {
      const path = worktreePath('/path/to/my-repo', 'cheenoski-12345-42-feature');
      expect(path).toContain(tmpdir());
      expect(path).toContain('cheenoski-worktrees');
      expect(path).toContain('my-repo');
      expect(path).toContain('cheenoski-12345-42-feature');
    });

    it('should sanitize repo names and branch names in paths', () => {
      const path = worktreePath('/path/to/repo with spaces', 'branch/with/slashes');
      expect(path).not.toContain('with spaces');
      expect(path).not.toContain('with/slashes');
      expect(path).toContain('repo-with-spaces');
      expect(path).toContain('branch-with-slashes');
    });
  });

  describe('List worktrees', () => {
    it('should list all active Cheenoski worktrees', async () => {
      const wt1 = await createWorktree(testRepo, 'main', 201, 'list-test-1');
      const wt2 = await createWorktree(testRepo, 'main', 202, 'list-test-2');

      const list = await listWorktrees(testRepo);

      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            branch: wt1.branch,
            issueNumber: 201,
          }),
          expect.objectContaining({
            branch: wt2.branch,
            issueNumber: 202,
          }),
        ])
      );

      // Cleanup
      await Promise.all([
        removeWorktree(testRepo, wt1.path, wt1.branch, 201, true),
        removeWorktree(testRepo, wt2.path, wt2.branch, 202, true),
      ]);
    });

    it('should filter out non-Cheenoski worktrees', async () => {
      // Create a manual branch that doesn't match Cheenoski pattern
      await git(['branch', 'manual-branch'], testRepo);
      const manualWtPath = join(tmpdir(), 'manual-worktree-test');
      await git(['worktree', 'add', manualWtPath, 'manual-branch'], testRepo);

      const list = await listWorktrees(testRepo);

      // Should not include the manual worktree
      const hasManual = list.some(wt => wt.branch === 'manual-branch');
      expect(hasManual).toBe(false);

      // Cleanup
      await git(['worktree', 'remove', '--force', manualWtPath], testRepo);
      await git(['branch', '-D', 'manual-branch'], testRepo);
    });
  });

  describe('Prune worktree metadata', () => {
    it('should prune stale worktree metadata successfully', async () => {
      const issueNumber = 300;
      const slug = 'prune-test';

      // Create worktree
      const wt = await createWorktree(testRepo, 'main', issueNumber, slug);

      // Remove directory but leave metadata
      await rm(wt.path, { recursive: true, force: true });

      // Prune should return true
      const result = await pruneWorktreeMetadata(testRepo);
      expect(result).toBe(true);

      // Verify metadata is cleaned
      const metadataPath = join(testRepo, '.git', 'worktrees', wt.branch);
      expect(existsSync(metadataPath)).toBe(false);

      // Cleanup branch
      await git(['branch', '-D', wt.branch], testRepo);
    });

    it('should be safe to call multiple times', async () => {
      await expect(pruneWorktreeMetadata(testRepo)).resolves.toBe(true);
      await expect(pruneWorktreeMetadata(testRepo)).resolves.toBe(true);
      await expect(pruneWorktreeMetadata(testRepo)).resolves.toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should rollback on worktree creation failure', async () => {
      // Try to create worktree from non-existent base branch
      await expect(
        createWorktree(testRepo, 'non-existent-branch', 999, 'fail-test')
      ).rejects.toThrow();

      // Verify no orphaned branches or worktrees
      const worktrees = await listWorktrees(testRepo);
      const hasOrphaned = worktrees.some(wt => wt.issueNumber === 999);
      expect(hasOrphaned).toBe(false);
    });

    it('should handle missing repository gracefully', async () => {
      const fakeRepo = '/path/that/does/not/exist';

      await expect(
        cleanupForRetry(fakeRepo, '/fake/worktree', 'fake-branch')
      ).resolves.not.toThrow();

      // Should log warnings but not crash
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
