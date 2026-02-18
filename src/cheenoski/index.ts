import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MessageBus } from '../core/message-bus.js';
import type { EchelonConfig } from '../lib/types.js';
import type { SchedulerState } from './types.js';
import { logger } from '../lib/logger.js';
import { fetchIssuesByLabel } from './github/issues.js';
import { preflightChecks, cleanOrphanedWorktrees, postRunAudit } from './git/guardrails.js';
import { acquireLock, releaseLock, hasConflictingInstance } from './coordination.js';
import { Scheduler } from './scheduler.js';

const execFileAsync = promisify(execFile);

/**
 * CheenoskiRunner — public API for invoking the engineering layer.
 * TypeScript engineering layer.
 */
export class CheenoskiRunner {
  private scheduler: Scheduler | null = null;
  private signalHandlers: { sigint: () => void; sigterm: () => void } | null = null;

  constructor(
    private config: EchelonConfig,
    private bus: MessageBus,
  ) {}

  /**
   * Run Cheenoski for a given GitHub label.
   * Fetches issues, runs them through the sliding window scheduler,
   * and returns the final state.
   */
  async run(label: string, maxParallel?: number): Promise<SchedulerState> {
    const config = maxParallel
      ? { ...this.config, engineers: { ...this.config.engineers, maxParallel } }
      : this.config;

    // Acquire coordination lock FIRST to prevent TOCTOU race
    acquireLock(label);

    // Small delay to ensure our lock file is visible to other processes
    await new Promise(resolve => setTimeout(resolve, 50));

    // Then check for conflicting instances
    const conflict = hasConflictingInstance(label);
    if (conflict) {
      // Use PID as tiebreaker (lower PID wins)
      if (conflict.pid < process.pid) {
        // We lose the race, clean up and abort
        releaseLock();
        throw new Error(
          `Another Cheenoski instance (PID ${conflict.pid}) is already processing "${label}". ` +
          `Started at ${conflict.startedAt}.`
        );
      } else {
        // We win the race - other process should abort soon
        // Wait for them to clean up
        await new Promise(resolve => setTimeout(resolve, 100));

        // Double-check they're gone
        const stillConflicting = hasConflictingInstance(label);
        if (stillConflicting && stillConflicting.pid < process.pid) {
          // Other process didn't abort, we should
          releaseLock();
          throw new Error(
            `Another Cheenoski instance (PID ${stillConflicting.pid}) is already processing "${label}". ` +
            `Started at ${stillConflicting.startedAt}.`
          );
        }
      }
    }

    // Register signal handlers for clean shutdown (#12)
    this.registerSignalHandlers();

    try {
      // Record starting branch before doing anything
      let startBranch: string | undefined;
      try {
        const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
          cwd: config.project.path, encoding: 'utf-8',
        });
        startBranch = stdout.trim();
      } catch { /* ignore */ }

      // Preflight checks
      const preflight = await preflightChecks(config.project.path, config.project.baseBranch);
      if (!preflight.ok) {
        throw new Error(`Preflight failed:\n${preflight.errors.join('\n')}`);
      }

      // Clean orphaned worktrees from previous crashes
      const orphansCleaned = await cleanOrphanedWorktrees(config.project.path);
      if (orphansCleaned > 0) {
        logger.info(`Cleaned ${orphansCleaned} orphaned worktree(s) from previous run`);
      }

      // Fetch issues
      const issues = await fetchIssuesByLabel(config.project.repo, label);
      if (issues.length === 0) {
        logger.info(`No open issues found with label "${label}"`);
        return {
          slots: [],
          windowSize: config.engineers.maxParallel,
          activeCount: 0,
          completedCount: 0,
          failedCount: 0,
          totalIssues: 0,
        };
      }

      logger.info(`Found ${issues.length} issue(s) for label "${label}"`);

      // Run scheduler
      this.scheduler = new Scheduler(config, this.bus, label);
      const result = await this.scheduler.run(issues);

      // Post-run audit — pass the branch we started on
      const warnings = await postRunAudit(config.project.path, config.project.baseBranch, startBranch);
      for (const warning of warnings) {
        logger.warn(`Post-run audit: ${warning}`);
      }

      return result;
    } finally {
      this.unregisterSignalHandlers();
      releaseLock();
    }
  }

  /** Kill the running scheduler */
  kill(): void {
    if (this.scheduler) {
      this.scheduler.kill();
      this.scheduler = null;
    }
    this.unregisterSignalHandlers();
    releaseLock();
  }

  /** Register SIGINT/SIGTERM handlers for graceful cleanup */
  private registerSignalHandlers(): void {
    const cleanup = () => {
      logger.info('Signal received — cleaning up Cheenoski...');
      this.kill();
    };

    this.signalHandlers = {
      sigint: cleanup,
      sigterm: cleanup,
    };

    process.on('SIGINT', this.signalHandlers.sigint);
    process.on('SIGTERM', this.signalHandlers.sigterm);
  }

  /** Remove signal handlers */
  private unregisterSignalHandlers(): void {
    if (this.signalHandlers) {
      process.removeListener('SIGINT', this.signalHandlers.sigint);
      process.removeListener('SIGTERM', this.signalHandlers.sigterm);
      this.signalHandlers = null;
    }
  }
}
