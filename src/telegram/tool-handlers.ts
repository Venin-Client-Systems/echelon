import type { EchelonConfig } from '../lib/types.js';
import { Orchestrator } from '../core/orchestrator.js';
import { loadState, findLatestSession } from '../core/state.js';
import { SESSIONS_DIR } from '../lib/paths.js';
import { logger } from '../lib/logger.js';
import { LAYER_LABELS } from '../lib/types.js';

/** Singleton orchestrator for the Telegram session */
let activeOrchestrator: Orchestrator | null = null;

/** Callbacks to notify when orchestrator is created */
const orchestratorListeners: ((orch: Orchestrator) => void)[] = [];

/** Register a callback for when the orchestrator is created */
export function onOrchestratorCreated(cb: (orch: Orchestrator) => void): void {
  orchestratorListeners.push(cb);
  // If already exists, fire immediately
  if (activeOrchestrator) cb(activeOrchestrator);
}

/** Get or create the orchestrator */
function getOrchestrator(config: EchelonConfig): Orchestrator {
  if (activeOrchestrator) return activeOrchestrator;

  // Try to resume latest session
  const sessionId = findLatestSession(config.project.repo);
  const state = sessionId ? loadState(sessionId) : undefined;

  activeOrchestrator = new Orchestrator({
    config,
    cliOptions: {
      config: '',
      headless: true,
      dryRun: false,
      resume: !!state,
      verbose: false,
      telegram: true,
    },
    state: state ?? undefined,
  });

  // Notify listeners
  for (const cb of orchestratorListeners) {
    try {
      cb(activeOrchestrator);
    } catch (err) {
      logger.error('Orchestrator listener error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return activeOrchestrator;
}

/** Execute a CEO tool call and return the result string */
export async function executeCeoTool(
  name: string,
  input: Record<string, unknown>,
  config: EchelonConfig,
): Promise<string> {
  try {
    switch (name) {
      case 'start_cascade': {
        const directive = input.directive as string;
        if (!directive || typeof directive !== 'string' || directive.trim().length === 0) {
          return 'Error: directive is required and must be a non-empty string';
        }
        const orch = getOrchestrator(config);
        // Run cascade in background
        orch.runCascade(directive.trim()).catch((err: unknown) => {
          logger.error('Cascade error', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
        return `Cascade started for: "${directive.slice(0, 100)}".\nI'll send updates as each layer completes.`;
      }

      case 'cascade_status': {
        const orch = getOrchestrator(config);
        const state = orch.state;
        const lines = [
          `Session: ${state.sessionId}`,
          `Status: ${state.status}`,
          `Directive: ${state.directive.slice(0, 100)}`,
          `Total cost: $${state.totalCost.toFixed(2)}`,
          `Messages: ${state.messages.length}`,
          `Issues: ${state.issues.length}`,
          '',
          'Agent Status:',
        ];
        for (const [role, agent] of Object.entries(state.agents)) {
          const label = LAYER_LABELS[role as keyof typeof LAYER_LABELS] ?? role;
          lines.push(`  ${label}: ${agent.status} ($${agent.totalCost.toFixed(4)})`);
        }
        const pending = orch.executor.getPending();
        if (pending.length > 0) {
          lines.push('');
          lines.push(`Pending approvals: ${pending.length}`);
          for (const p of pending) {
            lines.push(`  [${p.id}] ${p.description}`);
          }
        }
        return lines.join('\n');
      }

      case 'approve_action': {
        const orch = getOrchestrator(config);
        const id = input.approval_id as string;
        if (!id || typeof id !== 'string') {
          return 'Error: approval_id is required and must be a string';
        }
        if (id === 'all') {
          const results = await orch.executor.approveAll();
          return results.length > 0
            ? `Approved ${results.length} action(s):\n${results.join('\n')}`
            : 'No pending actions to approve.';
        }
        const { executed, result } = await orch.executor.approve(id);
        return executed ? `Approved: ${result}` : `Failed: ${result}`;
      }

      case 'reject_action': {
        const orch = getOrchestrator(config);
        const id = input.approval_id as string;
        if (!id || typeof id !== 'string') {
          return 'Error: approval_id is required and must be a string';
        }
        const reason = (input.reason as string) || 'No reason given';
        orch.executor.reject(id, reason);
        return `Rejected action ${id}: ${reason}`;
      }

      case 'pause_cascade': {
        const orch = getOrchestrator(config);
        orch.shutdown();
        return 'Cascade paused. State saved. Resume with /resume.';
      }

      case 'resume_cascade': {
        activeOrchestrator = null;
        const orch = getOrchestrator(config);
        const state = orch.state;
        if (state.status !== 'paused') {
          return `Cannot resume — session is "${state.status}", not "paused".`;
        }
        orch.runCascade(state.directive).catch((err: unknown) => {
          logger.error('Resume error', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
        return `Resuming cascade: "${state.directive.slice(0, 100)}"`;
      }

      case 'ask_user': {
        const question = input.question as string;
        if (!question || typeof question !== 'string' || question.trim().length === 0) {
          return 'Error: question is required and must be a non-empty string';
        }
        return `QUESTION_FOR_USER: ${question}`;
      }

      case 'list_sessions': {
        const { readdirSync, existsSync } = await import('node:fs');
        if (!existsSync(SESSIONS_DIR)) return 'No sessions found.';
        const dirs = readdirSync(SESSIONS_DIR).sort().reverse().slice(0, 10);
        if (dirs.length === 0) return 'No sessions found.';
        const lines = dirs.map((id: string) => {
          const s = loadState(id);
          if (!s) return `${id.slice(0, 30)} | corrupt`;
          return `${id.slice(0, 30)} | ${s.status} | $${s.totalCost.toFixed(2)} | ${(s.directive ?? '').slice(0, 40)}`;
        });
        return `Recent sessions:\n${lines.join('\n')}`;
      }

      case 'get_cost': {
        const orch = getOrchestrator(config);
        const state = orch.state;
        const lines = [`Total cost: $${state.totalCost.toFixed(2)}`, ''];
        for (const [role, agent] of Object.entries(state.agents)) {
          const label = LAYER_LABELS[role as keyof typeof LAYER_LABELS] ?? role;
          lines.push(`  ${label}: $${agent.totalCost.toFixed(4)}`);
        }
        return lines.join('\n');
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`CEO tool error: ${name}`, { error: msg });
    return `Error: ${msg}`;
  }
}

/** Get the active orchestrator (for event subscriptions) */
export function getActiveOrchestrator(): Orchestrator | null {
  return activeOrchestrator;
}
