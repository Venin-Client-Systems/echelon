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
    return () => clearInterval(timer);
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
      switch (event.type) {
        case 'agent_status':
          setAgents(prev => ({
            ...prev,
            [event.role]: { ...prev[event.role], status: event.status },
          }));
          addFeedEntry(
            LAYER_LABELS[event.role],
            event.status === 'thinking' ? 'Thinking...' : event.status === 'done' ? 'Done' : event.status,
            ROLE_COLORS[event.role],
          );
          break;

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

        case 'action_executed':
          addFeedEntry('System', `Executed: ${event.action.action} — ${event.result.slice(0, 100)}`, 'green');
          break;

        case 'action_rejected':
          setPending(prev => prev.filter(p => p.id !== event.approval.id));
          addFeedEntry('System', `Rejected: ${event.approval.description}`, 'red');
          break;

        case 'issue_created':
          setIssues(prev => [...prev, event.issue]);
          addFeedEntry('System', `Issue #${event.issue.number}: ${event.issue.title}`, 'green');
          break;

        case 'ralphy_progress':
          addFeedEntry(`Eng:${event.label}`, event.line, 'green');
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

        case 'cascade_complete':
          setStatus('completed');
          addFeedEntry('System', 'Cascade complete', 'green');
          break;

        case 'shutdown':
          setStatus('paused');
          addFeedEntry('System', 'Session paused', 'yellow');
          break;
      }
    };

    orchestrator.bus.onEchelon(handler);
    return () => {
      orchestrator.bus.removeListener('echelon', handler);
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
