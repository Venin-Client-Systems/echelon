import type { MessageBus } from '../core/message-bus.js';
import type { EchelonConfig } from '../lib/types.js';
import type { CheenoskiIssue, Slot, SchedulerState, EngineRunner } from './types.js';
import { logger } from '../lib/logger.js';
import { detectDomain, canRunParallel, slugify } from './domain.js';
import { createWorktree, removeWorktree } from './git/worktree.js';
import { mergeBranch, createPullRequest, hasChanges } from './git/merge.js';
import { runWithFallback } from './engine/fallback.js';
import { isStuckResult } from './engine/result-parser.js';
import { buildEngineerPrompt } from './prompt-builder.js';
import { readLessons, propagateLessons, mergeLessonsBack } from './lessons.js';
import { claimIssue, releaseIssue } from './coordination.js';
import { closeIssue, commentOnIssue, blockIssue, detectLoop, isIssueInProgress } from './github/issues.js';
import { updateIssueStatus, updateIssueBranch } from './github/project-board.js';
import { reapOrphanedProcesses } from './cleanup.js';
import { sendDesktopNotification, playSound } from './notifications.js';

/**
 * Simple async mutex for serializing merge operations.
 * Prevents concurrent git merges into the same base branch.
 */
class AsyncMutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Sliding window parallel scheduler.
 * Fills N slots with issues, runs engines in worktrees, merges results back.
 */
export class Scheduler {
  private config: EchelonConfig;
  private bus: MessageBus;
  private label: string;
  private slots: Slot[] = [];
  private issueQueue: CheenoskiIssue[] = [];
  private activeEngines = new Map<number, EngineRunner>();
  private running = false;
  private startTime = 0;
  private mergeMutex = new AsyncMutex();
  /** Track running slot promises so we can await them on shutdown */
  private runningSlots = new Map<number, Promise<void>>();

  constructor(config: EchelonConfig, bus: MessageBus, label: string) {
    this.config = config;
    this.bus = bus;
    this.label = label;
  }

  get state(): SchedulerState {
    return {
      slots: [...this.slots],
      windowSize: this.config.engineers.maxParallel,
      activeCount: this.slots.filter(s => s.status === 'running' || s.status === 'merging').length,
      completedCount: this.slots.filter(s => s.status === 'done').length,
      failedCount: this.slots.filter(s => s.status === 'failed').length,
      totalIssues: this.slots.length + this.issueQueue.length,
    };
  }

  /** Run all issues through the sliding window scheduler */
  async run(issues: CheenoskiIssue[]): Promise<SchedulerState> {
    this.running = true;
    this.startTime = Date.now();
    this.issueQueue = [...issues];
    const maxParallel = this.config.engineers.maxParallel;

    logger.info(`Scheduler starting: ${issues.length} issues, ${maxParallel} parallel slots`);

    try {
      // Fill initial slots
      await this.fillSlots();

      // Process until all done
      while (this.running && this.hasPendingWork()) {
        this.emitDashboard();
        await this.tick();
        await sleep(1000); // Poll interval
      }

      // Wait for any still-running slots to finish
      if (this.runningSlots.size > 0) {
        await Promise.allSettled([...this.runningSlots.values()]);
      }

      // Final cleanup
      await reapOrphanedProcesses();
      this.emitDashboard();

      const stats = this.state;
      this.bus.emitEchelon({
        type: 'cheenoski_complete',
        label: this.label,
        stats: {
          total: stats.slots.length,
          succeeded: stats.completedCount,
          failed: stats.failedCount,
          blocked: this.slots.filter(s => s.status === 'blocked').length,
          durationMs: Date.now() - this.startTime,
          prsCreated: this.slots.filter(s => s.prNumber !== null).length,
        },
      });

      sendDesktopNotification(
        'Cheenoski Complete',
        `${stats.completedCount}/${stats.slots.length} succeeded (${this.label})`,
      );
      playSound(stats.failedCount === 0 ? 'success' : 'warning');

      return stats;
    } finally {
      this.running = false;
    }
  }

  /** Stop all running engines */
  kill(): void {
    this.running = false;
    for (const [slotId, engine] of this.activeEngines) {
      engine.kill();
      logger.info(`Killed engine for slot ${slotId}`);
    }
    this.activeEngines.clear();
  }

  /** Register an active engine for a slot (so kill() can reach it) */
  registerEngine(slotId: number, engine: EngineRunner): void {
    this.activeEngines.set(slotId, engine);
  }

  /** Unregister an engine when a slot completes */
  unregisterEngine(slotId: number): void {
    this.activeEngines.delete(slotId);
  }

  /** Fill available slots from the issue queue */
  private async fillSlots(): Promise<void> {
    const maxParallel = this.config.engineers.maxParallel;

    while (
      this.issueQueue.length > 0 &&
      this.getActiveSlotCount() < maxParallel
    ) {
      const issue = this.pickNextIssue();
      if (!issue) break;

      const slot = await this.createSlot(issue);
      if (slot) {
        this.slots.push(slot);
        this.bus.emitEchelon({ type: 'cheenoski_slot_fill', slot });

        // Track the running slot promise
        const slotPromise = this.runSlot(slot).catch((err) => {
          logger.error(`Unhandled error in slot #${slot.issueNumber}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        });
        this.runningSlots.set(slot.id, slotPromise);
        slotPromise.finally(() => this.runningSlots.delete(slot.id));
      }
    }
  }

  /** Pick the next issue that's compatible with running slots */
  private pickNextIssue(): CheenoskiIssue | null {
    const runningDomains = this.slots
      .filter(s => s.status === 'running')
      .map(s => s.domain);

    for (let i = 0; i < this.issueQueue.length; i++) {
      const issue = this.issueQueue[i];
      const domain = detectDomain(issue);

      // Check domain compatibility
      const compatible = runningDomains.every(rd => canRunParallel(rd, domain));
      if (compatible || runningDomains.length === 0) {
        this.issueQueue.splice(i, 1);
        return issue;
      }
    }

    // If no compatible issue found but queue not empty, take the first one
    // (it'll just wait for the conflicting slot to finish)
    if (this.issueQueue.length > 0 && this.getActiveSlotCount() === 0) {
      return this.issueQueue.shift()!;
    }

    return null;
  }

  /** Create a slot for an issue (worktree, branch, etc.) */
  private async createSlot(issue: CheenoskiIssue): Promise<Slot | null> {
    // Skip issues already in progress
    if (isIssueInProgress(issue)) {
      logger.info(`Issue #${issue.number} already in progress (assigned/WIP), skipping`);
      return null;
    }

    // Check for loops
    const isLoop = await detectLoop(this.config.project.repo, issue.number);
    if (isLoop) {
      await blockIssue(this.config.project.repo, issue.number,
        'Loop detected — issue was closed/reopened multiple times');
      return null;
    }

    // Claim the issue
    if (!claimIssue(issue.number)) {
      logger.info(`Issue #${issue.number} claimed by another instance, skipping`);
      return null;
    }

    const domain = detectDomain(issue);
    const engineName = this.config.engineers.engine ?? 'claude';

    return {
      id: this.slots.length,
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body,
      domain,
      labels: issue.labels,
      status: 'pending',
      branchName: '',
      worktreePath: null,
      engineName,
      attempt: 0,
      maxRetries: this.config.engineers.maxRetries ?? 2,
      result: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      prNumber: null,
    };
  }

  /** Run an engine in a slot's worktree */
  private async runSlot(slot: Slot): Promise<void> {
    const maxRetries = slot.maxRetries;

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (!this.running) return;

        slot.attempt = attempt;
        slot.status = 'running';
        slot.startedAt = new Date().toISOString();

        try {
          // Create worktree
          const wt = await createWorktree(
            this.config.project.path,
            this.config.project.baseBranch,
            slot.issueNumber,
            `${slugify(slot.issueTitle)}-${attempt}`,
          );
          slot.branchName = wt.branch;
          slot.worktreePath = wt.path;

          // Update project board
          if (this.config.engineers.projectBoard) {
            await updateIssueStatus(this.config.project.repo, this.config.engineers.projectBoard, slot.issueNumber, 'In Progress');
            await updateIssueBranch(this.config.project.repo, this.config.engineers.projectBoard, slot.issueNumber, wt.branch);
          }

          // Propagate lessons
          propagateLessons(this.config.project.path, wt.path);

          // Build prompt — pass full issue body
          const lessonsContext = readLessons(this.config.project.path) ?? undefined;
          const prompt = buildEngineerPrompt(
            { number: slot.issueNumber, title: slot.issueTitle, body: slot.issueBody, labels: slot.labels, state: 'open', assignees: [], url: '' },
            slot.domain,
            this.config,
            lessonsContext,
          );

          // Run engine with fallback — register for kill support
          const result = await runWithFallback(
            {
              prompt,
              cwd: wt.path,
              timeoutMs: this.config.engineers.hardTimeoutMs ?? 600_000,
              issueNumber: slot.issueNumber,
              lessonsContext,
            },
            slot.engineName,
            this.config.engineers.fallbackEngines ?? [],
            (from, to, reason) => {
              slot.engineName = to;
              this.bus.emitEchelon({
                type: 'cheenoski_engine_switch',
                slot: { ...slot },
                from, to, reason,
              });
            },
            // Engine registration callback
            (engine) => this.registerEngine(slot.id, engine),
          );

          this.unregisterEngine(slot.id);
          slot.result = result;

          // Check for actual changes: tool detection + git fallback
          let hasActualChanges = result.success && !isStuckResult(result);
          if (result.success && !hasActualChanges && slot.worktreePath) {
            // Tool detection missed changes — check git directly
            hasActualChanges = await hasChanges(slot.worktreePath, this.config.project.baseBranch);
            if (hasActualChanges) {
              logger.info(`Git detected changes in worktree for #${slot.issueNumber} (tool detection missed)`);
            }
          }

          if (hasActualChanges) {
            // Merge back — acquire mutex to prevent concurrent merges
            slot.status = 'merging';
            this.emitDashboard();

            await this.mergeMutex.acquire();
            let mergeResult;
            try {
              mergeResult = await mergeBranch(
                this.config.project.path,
                slot.branchName,
                this.config.project.baseBranch,
                slot.issueNumber,
              );
            } finally {
              this.mergeMutex.release();
            }

            if (mergeResult.success) {
              // Create PR if configured
              if (this.config.engineers.createPr) {
                try {
                  const pr = await createPullRequest(
                    this.config.project.repo,
                    slot.branchName,
                    this.config.project.baseBranch,
                    slot.issueTitle,
                    `Closes #${slot.issueNumber}\n\nAutomatic PR by Cheenoski.`,
                    this.config.engineers.prDraft,
                    this.config.project.path,
                  );
                  slot.prNumber = pr.number;
                  this.bus.emitEchelon({
                    type: 'cheenoski_pr_created',
                    slot: { ...slot },
                    prNumber: pr.number,
                    prUrl: pr.url,
                  });
                } catch (err) {
                  logger.warn(`PR creation failed for #${slot.issueNumber}: ${err instanceof Error ? err.message : err}`);
                }
              }

              // Close the issue
              await closeIssue(
                this.config.project.repo,
                slot.issueNumber,
                `Completed by Cheenoski (${slot.engineName}). ${slot.prNumber ? `PR #${slot.prNumber}` : 'Merged directly.'}`,
              );

              // Merge lessons back
              if (slot.worktreePath) {
                mergeLessonsBack(slot.worktreePath, this.config.project.path);
              }

              slot.status = 'done';
              this.bus.emitEchelon({
                type: 'cheenoski_merge',
                slot: { ...slot },
                success: true,
              });
            } else {
              // Merge failed
              slot.error = mergeResult.error ?? 'Merge failed';
              this.bus.emitEchelon({
                type: 'cheenoski_merge',
                slot: { ...slot },
                success: false,
                error: slot.error,
              });

              if (attempt < maxRetries) {
                logger.warn(`Merge failed for #${slot.issueNumber}, retrying (attempt ${attempt + 1}/${maxRetries})`);
                await this.cleanupSlotWorktree(slot);
                continue;
              }

              slot.status = 'failed';
              await blockIssue(this.config.project.repo, slot.issueNumber, `Merge failed: ${slot.error}`);
            }
          } else if (result.errorType === 'rate_limit') {
            if (attempt < maxRetries) {
              logger.warn(`All engines rate-limited for #${slot.issueNumber}, waiting before retry`);
              await this.cleanupSlotWorktree(slot);
              await sleep(30_000);
              continue;
            }
            slot.status = 'failed';
            slot.error = 'All engines rate-limited';
          } else if (isStuckResult(result)) {
            slot.error = 'No code changes detected';
            if (attempt < maxRetries) {
              await this.cleanupSlotWorktree(slot);
              continue;
            }
            slot.status = 'failed';
            await commentOnIssue(this.config.project.repo, slot.issueNumber,
              'Cheenoski completed but made no code changes. May need manual implementation.');
          } else {
            slot.error = result.output.slice(0, 500);
            if (attempt < maxRetries) {
              await this.cleanupSlotWorktree(slot);
              continue;
            }
            slot.status = 'failed';
            await commentOnIssue(this.config.project.repo, slot.issueNumber,
              `Cheenoski failed after ${maxRetries + 1} attempts. Error: ${slot.error.slice(0, 200)}`);
          }
        } catch (err) {
          slot.error = err instanceof Error ? err.message : String(err);
          if (attempt < maxRetries) {
            await this.cleanupSlotWorktree(slot);
            continue;
          }
          slot.status = 'failed';
        } finally {
          slot.finishedAt = new Date().toISOString();
          await this.cleanupSlotWorktree(slot);
          this.unregisterEngine(slot.id);
        }

        break; // Exit retry loop on success or final failure
      }
    } finally {
      // Release issue claim ONCE after the retry loop exits
      releaseIssue(slot.issueNumber);
    }

    this.bus.emitEchelon({ type: 'cheenoski_slot_done', slot: { ...slot } });

    // Fill freed slot
    await this.fillSlots();
  }

  private async cleanupSlotWorktree(slot: Slot): Promise<void> {
    if (slot.worktreePath) {
      await removeWorktree(this.config.project.path, slot.worktreePath, slot.branchName, slot.issueNumber);
      slot.worktreePath = null;
    }
  }

  private async tick(): Promise<void> {
    const stuckWarningMs = this.config.engineers.stuckWarningMs ?? 120_000;

    for (const slot of this.slots) {
      if (slot.status !== 'running' || !slot.startedAt) continue;

      const elapsed = Date.now() - new Date(slot.startedAt).getTime();
      // Warn once at threshold and then every 60s after
      if (elapsed > stuckWarningMs) {
        const sinceThreshold = elapsed - stuckWarningMs;
        if (sinceThreshold < 1000 || (sinceThreshold % 60_000 < 1000)) {
          logger.warn(`Slot #${slot.issueNumber} running for ${(elapsed / 1000).toFixed(0)}s — may be stuck`);
        }
      }
    }

    await this.fillSlots();
  }

  private hasPendingWork(): boolean {
    return (
      this.issueQueue.length > 0 ||
      this.slots.some(s => s.status === 'running' || s.status === 'merging' || s.status === 'pending')
    );
  }

  private getActiveSlotCount(): number {
    return this.slots.filter(s => s.status === 'running' || s.status === 'merging').length;
  }

  private emitDashboard(): void {
    this.bus.emitEchelon({ type: 'cheenoski_dashboard', state: this.state });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
