import { nanoid } from 'nanoid';
import { logger } from '../lib/logger.js';
import type {
  Action, AgentRole, EchelonConfig, EchelonState,
  PendingApproval,
} from '../lib/types.js';
import type { MessageBus } from './message-bus.js';
import { createIssues } from '../actions/github-issues.js';
import { invokeRalphy } from '../actions/ralphy.js';
import { createBranch } from '../actions/git.js';
import { requestReview } from '../actions/review.js';

/** Actions that require CEO approval in "destructive" mode */
const DESTRUCTIVE_ACTIONS = new Set(['create_issues', 'invoke_ralphy', 'create_branch']);

export class ActionExecutor {
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private ralphyKillHandles: Array<{ label: string; kill: () => void }> = [];

  constructor(
    private config: EchelonConfig,
    private state: EchelonState,
    private bus: MessageBus,
  ) {}

  /** Check if an action needs CEO approval */
  needsApproval(action: Action): boolean {
    switch (this.config.approvalMode) {
      case 'none': return false;
      case 'all': return true;
      case 'destructive': return DESTRUCTIVE_ACTIONS.has(action.action);
      default: return true; // unknown mode = require approval (safe default)
    }
  }

  /** Execute or queue an action */
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

  /** Execute an action immediately */
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
        const numbers = await createIssues(action.issues, this.config.project.repo);
        for (let i = 0; i < numbers.length; i++) {
          const issue = action.issues[i];
          this.state.issues.push({
            number: numbers[i],
            title: issue.title,
            state: 'open',
            labels: issue.labels,
            assignedEngineer: null,
            prNumber: null,
          });
          this.bus.emitEchelon({
            type: 'issue_created',
            issue: this.state.issues[this.state.issues.length - 1],
          });
        }
        return `Created issues: ${numbers.map(n => `#${n}`).join(', ')}`;
      }

      case 'invoke_cheenoski':
      case 'invoke_ralphy': {
        const handle = invokeRalphy(
          action.label,
          this.config,
          action.maxParallel,
          (line) => this.bus.emitEchelon({ type: 'ralphy_progress', label: action.label, line }),
        );
        this.ralphyKillHandles.push({ label: action.label, kill: handle.kill });
        return `Ralphy invoked for label: ${action.label}`;
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

  /** CEO approves a pending action */
  async approve(approvalId: string): Promise<{ executed: boolean; result: string }> {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) return { executed: false, result: `No pending approval: ${approvalId}` };
    this.pendingApprovals.delete(approvalId);
    return this.execute(approval.action);
  }

  /** CEO rejects a pending action */
  reject(approvalId: string, reason: string): void {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) return;
    this.pendingApprovals.delete(approvalId);
    this.bus.emitEchelon({ type: 'action_rejected', approval, reason });
  }

  /** Approve all pending actions — snapshot keys first to avoid mutation during iteration */
  async approveAll(): Promise<string[]> {
    const ids = [...this.pendingApprovals.keys()];
    const results: string[] = [];
    for (const id of ids) {
      const { result } = await this.approve(id);
      results.push(result);
    }
    return results;
  }

  /** Get all pending approvals */
  getPending(): PendingApproval[] {
    return [...this.pendingApprovals.values()];
  }

  /** Kill all running Ralphy subprocesses */
  killAllRalphy(): void {
    for (const handle of this.ralphyKillHandles) {
      try {
        handle.kill();
      } catch {
        logger.debug(`Failed to kill Ralphy process: ${handle.label}`);
      }
    }
    this.ralphyKillHandles = [];
  }
}

function describeAction(action: Action): string {
  switch (action.action) {
    case 'create_issues':
      return `Create ${action.issues.length} issue(s): ${action.issues.map(i => i.title).join(', ')}`;
    case 'invoke_cheenoski':
      return `Run Cheenoski for label: ${action.label}`;
    case 'invoke_ralphy':
      return `Run Ralphy for label: ${action.label}`;
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
