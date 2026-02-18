import { nanoid } from 'nanoid';
import { logger } from '../lib/logger.js';
import type {
  Action, AgentRole, EchelonConfig, EchelonState,
  PendingApproval,
} from '../lib/types.js';
import type { MessageBus } from './message-bus.js';
import { createIssues } from '../actions/github-issues.js';
import { invokeCheenoski } from '../actions/cheenoski.js';
import { createBranch } from '../actions/git.js';
import { requestReview } from '../actions/review.js';

/** Actions that require CEO approval in "destructive" mode */
const DESTRUCTIVE_ACTIONS = new Set(['create_issues', 'invoke_cheenoski', 'create_branch']);

/**
 * Executes or queues actions based on approval mode.
 *
 * The ActionExecutor manages action dispatch and approval queue management.
 * It supports three approval modes:
 * - `none`: Auto-execute all actions
 * - `destructive`: Require approval for create_issues, invoke_cheenoski, create_branch
 * - `all`: Require approval for every action
 *
 * @category Core
 * @example
 * ```typescript
 * const executor = new ActionExecutor(config, state, bus);
 *
 * // Execute or queue an action
 * const result = await executor.executeOrQueue(
 *   { action: 'create_issues', issues: [...] },
 *   'team-lead',
 *   false
 * );
 *
 * // Approve pending actions
 * if (!result.executed) {
 *   const approvalId = extractApprovalId(result.result);
 *   await executor.approve(approvalId);
 * }
 * ```
 */
export class ActionExecutor {
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private cheenoskiKillHandles: Array<{ label: string; kill: () => void }> = [];

  constructor(
    private config: EchelonConfig,
    private state: EchelonState,
    private bus: MessageBus,
  ) {}

  /**
   * Check if an action requires CEO approval based on config.approvalMode.
   *
   * @param action - The action to check
   * @returns true if approval is required
   */
  needsApproval(action: Action): boolean {
    switch (this.config.approvalMode) {
      case 'none': return false;
      case 'all': return true;
      case 'destructive': return DESTRUCTIVE_ACTIONS.has(action.action);
      default: return true; // unknown mode = require approval (safe default)
    }
  }

  /**
   * Execute an action immediately or queue it for approval.
   *
   * In dry-run mode, actions are logged but not executed.
   * If approval is required, the action is queued and an approval ID is returned.
   *
   * @param action - The action to execute
   * @param from - The agent role requesting execution
   * @param dryRun - If true, log the action without executing
   * @returns Object with executed flag and result message
   */
  async executeOrQueue(
    action: Action,
    from: AgentRole,
    dryRun: boolean,
  ): Promise<{ executed: boolean; result: string }> {
    if (dryRun) {
      const desc = describeAction(action);
      logger.info(`[DRY RUN] Would execute: ${desc}`);
      return { executed: false, result: `[DRY RUN] ${desc}` };
    }

    if (this.needsApproval(action)) {
      const approval = this.queueForApproval(action, from);
      this.bus.emitEchelon({ type: 'action_pending', approval });
      logger.info(`Action queued for approval: ${describeAction(action)}`);
      return { executed: false, result: `Queued for CEO approval: ${approval.id}` };
    }

    return this.execute(action);
  }

  /**
   * Execute an action immediately without approval checks.
   *
   * Emits an `action_executed` event on success or logs errors on failure.
   *
   * @param action - The action to execute
   * @returns Object with executed flag and result message
   */
  async execute(action: Action): Promise<{ executed: boolean; result: string }> {
    try {
      const result = await this.dispatch(action);
      this.bus.emitEchelon({ type: 'action_executed', action, result });
      return { executed: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Action execution failed', { action: action.action, error: msg });
      return { executed: false, result: `Error: ${msg}` };
    }
  }

  /** Dispatch to the right action handler */
  private async dispatch(action: Action): Promise<string> {
    switch (action.action) {
      case 'create_issues': {
        const created = await createIssues(action.issues, this.config.project.repo);
        for (const ci of created) {
          this.state.issues.push({
            number: ci.number,
            title: ci.title,
            state: 'open',
            labels: ci.labels,
            assignedEngineer: null,
            prNumber: null,
          });
          this.bus.emitEchelon({
            type: 'issue_created',
            issue: this.state.issues[this.state.issues.length - 1],
          });
        }
        if (created.length === 0) {
          return `No issues created (${action.issues.length} attempted)`;
        }
        return `Created ${created.length}/${action.issues.length} issues: ${created.map(c => `#${c.number}`).join(', ')}`;
      }

      case 'invoke_cheenoski': {
        const handle = invokeCheenoski(
          action.label,
          this.config,
          action.maxParallel,
          this.bus,
          (line) => this.bus.emitEchelon({ type: 'cheenoski_progress', label: action.label, line }),
        );
        const killHandle = { label: action.label, kill: handle.kill };
        this.cheenoskiKillHandles.push(killHandle);

        // Remove handle when Cheenoski completes to prevent memory leak
        handle.onComplete(() => {
          const idx = this.cheenoskiKillHandles.indexOf(killHandle);
          if (idx !== -1) {
            this.cheenoskiKillHandles.splice(idx, 1);
          }
        });

        return `Cheenoski invoked for label: ${action.label}`;
      }

      case 'create_branch': {
        await createBranch(action.branch_name, this.config.project.path, action.from);
        return `Branch created: ${action.branch_name}`;
      }

      case 'request_review': {
        const result = await requestReview(action.pr_number, this.config.project.repo, action.focus);
        return result;
      }

      case 'update_plan': {
        this.state.plan = action.plan;
        return `Plan updated with ${action.workstreams?.length ?? 0} workstreams`;
      }

      case 'request_info': {
        return `Info requested from ${action.target}: ${action.question}`;
      }

      case 'escalate': {
        return `Escalation: ${action.reason} — Decision needed: ${action.decision_needed}`;
      }
    }
  }

  /** Queue an action for CEO approval */
  private queueForApproval(action: Action, from: AgentRole): PendingApproval {
    const approval: PendingApproval = {
      id: nanoid(8),
      action,
      from,
      description: describeAction(action),
      timestamp: new Date().toISOString(),
    };
    this.pendingApprovals.set(approval.id, approval);
    return approval;
  }

  /**
   * Approve and execute a pending action.
   *
   * @param approvalId - The unique ID of the pending approval
   * @returns Execution result
   */
  async approve(approvalId: string): Promise<{ executed: boolean; result: string }> {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) return { executed: false, result: `No pending approval: ${approvalId}` };
    this.pendingApprovals.delete(approvalId);
    return this.execute(approval.action);
  }

  /**
   * Reject a pending action and emit an action_rejected event.
   *
   * @param approvalId - The unique ID of the pending approval
   * @param reason - Human-readable rejection reason
   */
  reject(approvalId: string, reason: string): void {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) return;
    this.pendingApprovals.delete(approvalId);
    this.bus.emitEchelon({ type: 'action_rejected', approval, reason });
  }

  /**
   * Approve all pending actions in sequence.
   *
   * Snapshots the approval IDs first to avoid mutation during iteration.
   * Useful for headless/YOLO mode or batch approval.
   *
   * @returns Array of execution results
   */
  async approveAll(): Promise<string[]> {
    const ids = [...this.pendingApprovals.keys()];
    const results: string[] = [];
    for (const id of ids) {
      const { result } = await this.approve(id);
      results.push(result);
    }
    return results;
  }

  /**
   * Get all pending approvals awaiting CEO decision.
   *
   * @returns Array of pending approval objects
   */
  getPending(): PendingApproval[] {
    return [...this.pendingApprovals.values()];
  }

  /**
   * Terminate all running Cheenoski subprocesses.
   *
   * Called during graceful shutdown or when aborting a cascade.
   */
  killAll(): void {
    for (const handle of this.cheenoskiKillHandles) {
      try {
        handle.kill();
      } catch {
        logger.debug(`Failed to kill Cheenoski process: ${handle.label}`);
      }
    }
    this.cheenoskiKillHandles = [];
  }
}

function describeAction(action: Action): string {
  switch (action.action) {
    case 'create_issues':
      return `Create ${action.issues.length} issue(s): ${action.issues.map(i => i.title).join(', ')}`;
    case 'invoke_cheenoski':
      return `Run Cheenoski for label: ${action.label}`;
    case 'update_plan':
      return `Update plan (${action.workstreams?.length ?? 0} workstreams)`;
    case 'request_info':
      return `Request info from ${action.target}`;
    case 'escalate':
      return `Escalate: ${action.reason}`;
    case 'request_review':
      return `Review PR #${action.pr_number}`;
    case 'create_branch':
      return `Create branch: ${action.branch_name}`;
  }
}
