import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  EchelonEvent, EchelonState, AgentRole, AgentStatus,
  PendingApproval, TrackedIssue, LayerMessage,
} from '../../lib/types.js';
import { LAYER_ORDER, LAYER_LABELS } from '../../lib/types.js';
import type { Orchestrator } from '../../core/orchestrator.js';

export interface FeedEntry {
  id: string;
  timestamp: string;
  source: string;
  text: string;
  color: string;
}

export interface EchelonUI {
  agents: Record<AgentRole, { status: AgentStatus; cost: number }>;
  feed: FeedEntry[];
  issues: TrackedIssue[];
  pendingApprovals: PendingApproval[];
  totalCost: number;
  elapsed: string;
  status: EchelonState['status'];
  directive: string;
  repo: string;

  sendDirective: (directive: string) => void;
  approve: (id?: string) => void;
  reject: (id: string, reason: string) => void;
  shutdown: () => void;
}

const ROLE_COLORS: Record<AgentRole, string> = {
  ceo: 'yellow',
  '2ic': 'cyan',
  'eng-lead': 'blue',
  'team-lead': 'magenta',
  engineer: 'green',
};

export function useEchelon(orchestrator: Orchestrator): EchelonUI {
  const feedCounterRef = useRef(0);
  const progressBufferRef = useRef<Record<AgentRole, string>>({} as Record<AgentRole, string>);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [agents, setAgents] = useState<EchelonUI['agents']>(() => {
    const initial = {} as EchelonUI['agents'];
    for (const role of LAYER_ORDER) {
      initial[role] = { status: 'idle', cost: 0 };
    }
    return initial;
  });

  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [issues, setIssues] = useState<TrackedIssue[]>([]);
  const [pendingApprovals, setPending] = useState<PendingApproval[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [status, setStatus] = useState<EchelonState['status']>('running');
  const [directive, setDirective] = useState(orchestrator.state.directive);
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState('0:00');

  // Elapsed timer
  useEffect(() => {
    const timer = setInterval(() => {
      const sec = Math.floor((Date.now() - startRef.current) / 1000);
      const min = Math.floor(sec / 60);
      const s = sec % 60;
      setElapsed(`${min}:${s.toString().padStart(2, '0')}`);
    }, 1000);
    return () => {
      clearInterval(timer);
      // Clean up progress timer
      if (progressTimerRef.current) {
        clearTimeout(progressTimerRef.current);
      }
    };
  }, []);

  const addFeedEntry = useCallback((source: string, text: string, color: string) => {
    const entry: FeedEntry = {
      id: String(++feedCounterRef.current),
      timestamp: new Date().toISOString().slice(11, 19),
      source,
      text,
      color,
    };
    setFeed(prev => [...prev.slice(-100), entry]); // keep last 100
  }, []);

  // Subscribe to orchestrator events
  useEffect(() => {
    const handler = (event: EchelonEvent) => {
      try {
        switch (event.type) {
          case 'agent_status':
            setAgents(prev => ({
              ...prev,
              [event.role]: { ...prev[event.role], status: event.status },
            }));
            // Show status changes with descriptive messages
            const statusMessages: Record<AgentStatus, string> = {
              idle: 'Idle',
              thinking: 'Starting analysis...',
              executing: 'Executing action...',
              waiting: 'Waiting...',
              error: 'Error occurred',
              done: '✓ Complete',
            };
            addFeedEntry(
              LAYER_LABELS[event.role],
              statusMessages[event.status],
              ROLE_COLORS[event.role],
            );
            break;

        case 'agent_progress': {
          // Aggregate chunks per agent to avoid excessive re-renders
          const chunk = event.content;
          if (!chunk) break;

          // Append chunk to buffer
          progressBufferRef.current[event.role] = (progressBufferRef.current[event.role] || '') + chunk;

          // Debounce: flush buffer after 500ms of inactivity
          if (progressTimerRef.current) {
            clearTimeout(progressTimerRef.current);
          }

          progressTimerRef.current = setTimeout(() => {
            const buffered = progressBufferRef.current[event.role];
            if (buffered && buffered.trim()) {
              // Extract meaningful lines (skip empty, skip JSON output format markers)
              const lines = buffered.split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('{') && !l.startsWith('}') && l !== 'result')
                .slice(-3); // Last 3 lines only

              if (lines.length > 0) {
                // Add ellipsis if content is truncated to show it's ongoing
                const content = lines.length === 3 ? `${lines.join(' | ')}...` : lines.join(' | ');
                addFeedEntry(LAYER_LABELS[event.role], content, ROLE_COLORS[event.role]);
              }
            }
            progressBufferRef.current[event.role] = '';
          }, 500);
          break;
        }

        case 'message': {
          const label = LAYER_LABELS[event.message.from];
          const text = event.message.content.replace(/```json[\s\S]*?```/g, '').trim();
          const preview = text.slice(0, 200).replace(/\n/g, ' ');
          addFeedEntry(label, preview, ROLE_COLORS[event.message.from]);
          break;
        }

        case 'action_pending':
          setPending(prev => [...prev, event.approval]);
          addFeedEntry('System', `Approval needed: ${event.approval.description}`, 'yellow');
          break;

        case 'action_executed': {
          // Make action descriptions more readable
          const actionLabels: Record<string, string> = {
            create_issues: 'Created GitHub issues',
            invoke_cheenoski: 'Started Cheenoski execution',
            update_plan: 'Updated plan',
            create_branch: 'Created branch',
            request_review: 'Requested PR review',
            request_info: 'Requested information',
            escalate: 'Escalated to higher layer',
          };
          const actionLabel = actionLabels[event.action.action] || event.action.action;
          const preview = event.result.slice(0, 100);
          addFeedEntry('System', `✓ ${actionLabel} — ${preview}`, 'green');
          break;
        }

        case 'action_rejected':
          setPending(prev => prev.filter(p => p.id !== event.approval.id));
          addFeedEntry('System', `Rejected: ${event.approval.description}`, 'red');
          break;

        case 'issue_created':
          setIssues(prev => [...prev, event.issue]);
          addFeedEntry('System', `Issue #${event.issue.number}: ${event.issue.title}`, 'green');
          break;

        case 'timeout_warning': {
          const elapsed = Math.floor(event.elapsed / 1000);
          const timeout = Math.floor(event.timeout / 1000);
          const color = event.percent >= 90 ? 'red' : event.percent >= 75 ? 'yellow' : 'cyan';
          const emoji = event.percent >= 90 ? '⚠️ ' : event.percent >= 75 ? '⏳ ' : '⏱️ ';
          addFeedEntry(
            LAYER_LABELS[event.role],
            `${emoji}${event.percent}% timeout (${elapsed}s / ${timeout}s)`,
            color,
          );
          break;
        }

        case 'cheenoski_progress':
          addFeedEntry(`Eng:${event.label}`, event.line, 'green');
          break;


        case 'cheenoski_slot_fill':
          addFeedEntry('Cheenoski', `Slot ${event.slot.id}: #${event.slot.issueNumber} (${event.slot.domain}) → ${event.slot.engineName}`, 'cyan');
          break;

        case 'cheenoski_slot_done': {
          const ok = event.slot.result?.success ?? false;
          const dur = event.slot.result?.durationMs ?? 0;
          addFeedEntry('Cheenoski', `#${event.slot.issueNumber}: ${ok ? 'done' : 'failed'} (${(dur / 1000).toFixed(0)}s)`, ok ? 'green' : 'red');
          break;
        }

        case 'cheenoski_dashboard':
          // skip — too noisy for feed log
          break;

        case 'cheenoski_merge':
          addFeedEntry('Cheenoski', `Merge #${event.slot.issueNumber}: ${event.success ? 'ok' : event.error ?? 'unknown error'}`, event.success ? 'green' : 'red');
          break;

        case 'cheenoski_pr_created':
          addFeedEntry('Cheenoski', `PR #${event.prNumber} for #${event.slot.issueNumber}: ${event.prUrl}`, 'green');
          break;

        case 'cheenoski_engine_switch':
          addFeedEntry('Cheenoski', `#${event.slot.issueNumber}: ${event.from} → ${event.to} (${event.reason})`, 'yellow');
          break;

        case 'cheenoski_complete':
          addFeedEntry('Cheenoski', `Complete: ${event.stats.succeeded}/${event.stats.total} succeeded (${(event.stats.durationMs / 1000).toFixed(0)}s)`, 'green');
          break;
        case 'cost_update':
          // Use absolute totalUsd from event, not accumulated delta
          setTotalCost(event.totalUsd);
          setAgents(prev => ({
            ...prev,
            [event.role]: { ...prev[event.role], cost: prev[event.role].cost + event.costUsd },
          }));
          break;

        case 'error':
          addFeedEntry(LAYER_LABELS[event.role], `Error: ${event.error}`, 'red');
          break;

        case 'cascade_complete': {
          setStatus('completed');

          // Show detailed completion summary
          const { summary } = event;
          const durationMin = Math.floor(summary.duration / 60000);
          const durationSec = Math.floor((summary.duration % 60000) / 1000);
          const timeStr = durationMin > 0 ? `${durationMin}m ${durationSec}s` : `${durationSec}s`;

          addFeedEntry('System', '═══════════════════════════════════════', 'green');
          addFeedEntry('System', '✓ COMPLETE - Here\'s what happened:', 'green');
          addFeedEntry('System', '───────────────────────────────────────', 'green');

          if (summary.issuesCreated > 0) {
            addFeedEntry('System', `✓ Created ${summary.issuesCreated} GitHub issue${summary.issuesCreated > 1 ? 's' : ''}`, 'green');
          } else {
            addFeedEntry('System', '• No issues created (test/planning only)', 'yellow');
          }

          if (summary.actionsExecuted > 0) {
            addFeedEntry('System', `✓ Executed ${summary.actionsExecuted} action${summary.actionsExecuted > 1 ? 's' : ''}`, 'green');
          }

          addFeedEntry('System', `💰 Cost: $${summary.totalCost.toFixed(4)} | ⏱ Time: ${timeStr}`, 'cyan');

          if (summary.pendingApprovals > 0) {
            addFeedEntry('System', `⚠️  ${summary.pendingApprovals} action${summary.pendingApprovals > 1 ? 's' : ''} need approval`, 'yellow');
            addFeedEntry('System', 'Run: echelon --resume (to approve)', 'yellow');
          }

          addFeedEntry('System', '───────────────────────────────────────', 'green');
          addFeedEntry('System', 'NEXT STEPS:', 'cyan');

          if (summary.issuesCreated > 0) {
            addFeedEntry('System', '1. Check GitHub issues in your repo', 'cyan');
            addFeedEntry('System', '2. Review any PRs created by agents', 'cyan');
            addFeedEntry('System', '3. Run: echelon status (to check progress)', 'cyan');
          } else {
            addFeedEntry('System', '1. Review the cascade output above', 'cyan');
            addFeedEntry('System', '2. Run: echelon -d "your next task"', 'cyan');
          }

          addFeedEntry('System', '═══════════════════════════════════════', 'green');
          break;
        }

        case 'shutdown':
          setStatus('paused');
          addFeedEntry('System', 'Session paused', 'yellow');
          break;
        }
      } catch (err) {
        console.error('Event handler error:', err);
      }
    };

    orchestrator.bus.onEchelon(handler);
    return () => {
      orchestrator.bus.offEchelon(handler);
    };
  }, [orchestrator, addFeedEntry]);

  const sendDirective = useCallback((text: string) => {
    setDirective(text);
    setStatus('running');
    addFeedEntry('CEO', text, 'yellow');
    // Orchestrator itself guards against concurrent cascades
    orchestrator.runCascade(text).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      addFeedEntry('System', `Cascade error: ${msg}`, 'red');
      setStatus('failed');
    });
  }, [orchestrator, addFeedEntry]);

  const approve = useCallback((id?: string) => {
    if (id) {
      orchestrator.executor.approve(id)
        .then(() => setPending(prev => prev.filter(p => p.id !== id)))
        .catch((err) => addFeedEntry('System', `Approve failed: ${err instanceof Error ? err.message : err}`, 'red'));
    } else {
      orchestrator.executor.approveAll()
        .then(() => setPending([]))
        .catch((err) => addFeedEntry('System', `Approve all failed: ${err instanceof Error ? err.message : err}`, 'red'));
    }
  }, [orchestrator, addFeedEntry]);

  const reject = useCallback((id: string, reason: string) => {
    orchestrator.executor.reject(id, reason);
    setPending(prev => prev.filter(p => p.id !== id));
  }, [orchestrator]);

  const shutdown = useCallback(() => {
    orchestrator.shutdown();
  }, [orchestrator]);

  return {
    agents,
    feed,
    issues,
    pendingApprovals,
    totalCost,
    elapsed,
    status,
    directive,
    repo: orchestrator.config.project.repo,
    sendDirective,
    approve,
    reject,
    shutdown,
  };
}
