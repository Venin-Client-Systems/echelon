import { useState, useEffect, useRef } from 'react';
import type { EchelonEvent, EchelonState } from '../../lib/types.js';
import { CascadeFlow } from './CascadeFlow.js';
import { ActivityFeed } from './ActivityFeed.js';
import { MetricsPanel } from './MetricsPanel.js';
import { SessionSelector } from './SessionSelector.js';

export function App() {
  const [state, setState] = useState<EchelonState | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = () => {
    const token = new URLSearchParams(window.location.search).get('token') || localStorage.getItem('echelon_token');
    if (!token) {
      console.error('No auth token found');
      return;
    }

    const ws = new WebSocket(`ws://${window.location.hostname}:3030?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
      reconnectTimeoutRef.current = 1000;

      // Fetch initial state
      fetch('/api/state')
        .then(r => r.json())
        .then(data => {
          console.log('Initial state loaded', data);
          setState(data);
        })
        .catch(err => console.error('Failed to fetch initial state:', err));
    };

    ws.onmessage = (msg) => {
      try {
        const event: EchelonEvent = JSON.parse(msg.data);
        // Apply event delta to state
        setState(prev => applyEventDelta(prev, event));
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
      wsRef.current = null;

      // Exponential backoff reconnection
      reconnectTimerRef.current = setTimeout(() => {
        console.log(`Reconnecting in ${reconnectTimeoutRef.current}ms...`);
        connect();
      }, reconnectTimeoutRef.current);

      reconnectTimeoutRef.current = Math.min(reconnectTimeoutRef.current * 2, 30000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  };

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  if (!state) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-cyan-400">Echelon Dashboard</h1>
            <span className={`flex items-center gap-2 text-sm ${connected ? 'text-green-400' : 'text-red-400'}`}>
              <span className="w-2 h-2 rounded-full bg-current"></span>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <SessionSelector currentSessionId={state.sessionId} />
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Cascade Flow */}
          <div className="lg:col-span-1">
            <CascadeFlow agents={state.agents} />
          </div>

          {/* Middle: Metrics */}
          <div className="lg:col-span-2">
            <MetricsPanel state={state} />
          </div>
        </div>

        {/* Bottom: Activity Feed */}
        <div className="mt-6">
          <ActivityFeed messages={state.messages} />
        </div>
      </main>
    </div>
  );
}

function applyEventDelta(state: EchelonState | null, event: EchelonEvent): EchelonState | null {
  if (!state) return state;

  // Shallow clone and apply updates
  switch (event.type) {
    case 'agent_status':
      return {
        ...state,
        agents: {
          ...state.agents,
          [event.role]: {
            ...state.agents[event.role],
            status: event.status,
          },
        },
      };

    case 'message':
      return {
        ...state,
        messages: [...state.messages, event.message],
      };

    case 'issue_created':
      return {
        ...state,
        issues: [...state.issues, event.issue],
      };

    case 'cost_update':
      return {
        ...state,
        totalCost: event.totalUsd,
        agents: {
          ...state.agents,
          [event.role]: {
            ...state.agents[event.role],
            totalCost: state.agents[event.role].totalCost + event.costUsd,
          },
        },
      };

    case 'state_saved':
      return {
        ...state,
        updatedAt: new Date().toISOString(),
      };

    case 'cascade_complete':
      return {
        ...state,
        status: 'completed',
        cascadePhase: 'complete',
      };

    case 'shutdown':
      return {
        ...state,
        status: 'paused',
      };

    default:
      return state;
  }
}
