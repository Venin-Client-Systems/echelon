import type { AgentRole, AgentStatus, AgentState } from '../../lib/types.js';
import { LAYER_ORDER, LAYER_LABELS } from '../../lib/types.js';

interface CascadeFlowProps {
  agents: Record<AgentRole, AgentState>;
}

const STATUS_ICONS: Record<AgentStatus, { icon: string; color: string }> = {
  idle: { icon: '○', color: 'text-gray-500' },
  thinking: { icon: '◆', color: 'text-cyan-400' },
  executing: { icon: '▶', color: 'text-green-400' },
  waiting: { icon: '⏳', color: 'text-yellow-400' },
  error: { icon: '✗', color: 'text-red-400' },
  done: { icon: '●', color: 'text-green-400' },
};

const STATUS_BG: Record<AgentStatus, string> = {
  idle: 'bg-gray-800',
  thinking: 'bg-cyan-900/30',
  executing: 'bg-green-900/30',
  waiting: 'bg-yellow-900/30',
  error: 'bg-red-900/30',
  done: 'bg-green-900/30',
};

export function CascadeFlow({ agents }: CascadeFlowProps) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h2 className="text-xl font-bold text-white mb-4">Organization</h2>
      <div className="space-y-3">
        {LAYER_ORDER.map((role, index) => {
          const agent = agents[role];
          const { icon, color } = STATUS_ICONS[agent.status];
          const bgColor = STATUS_BG[agent.status];
          const label = LAYER_LABELS[role];
          const cost = agent.totalCost > 0 ? `$${agent.totalCost.toFixed(2)}` : '';

          return (
            <div key={role} className="relative">
              {/* Connection line to next layer */}
              {index < LAYER_ORDER.length - 1 && (
                <div className="absolute left-5 top-12 w-0.5 h-3 bg-gray-600"></div>
              )}

              {/* Agent card */}
              <div className={`${bgColor} rounded-lg border border-gray-600 p-3 transition-all`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-2xl ${color}`}>{icon}</span>
                    <div>
                      <div className="font-semibold text-white">{label}</div>
                      <div className="text-sm text-gray-400">
                        {agent.turnsCompleted} turns
                      </div>
                    </div>
                  </div>
                  {cost && (
                    <div className="text-sm font-mono text-gray-300">{cost}</div>
                  )}
                </div>
                {agent.lastError && (
                  <div className="mt-2 text-xs text-red-400 border-l-2 border-red-400 pl-2">
                    {agent.lastError}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
