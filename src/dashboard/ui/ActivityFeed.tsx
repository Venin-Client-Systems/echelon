import { useEffect, useRef } from 'react';
import type { LayerMessage, AgentRole } from '../../lib/types.js';
import { LAYER_LABELS } from '../../lib/types.js';

interface ActivityFeedProps {
  messages: LayerMessage[];
  maxLines?: number;
}

const ROLE_COLORS: Record<AgentRole, string> = {
  ceo: 'text-yellow-400',
  '2ic': 'text-cyan-400',
  'eng-lead': 'text-blue-400',
  'team-lead': 'text-magenta-400',
  engineer: 'text-green-400',
};

export function ActivityFeed({ messages, maxLines = 50 }: ActivityFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const visible = messages.slice(-maxLines);

  useEffect(() => {
    // Auto-scroll to bottom on new messages
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function formatRelativeTime(timestamp: string): string {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diff = Math.floor((now - then) / 1000); // seconds

    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }

  function formatContent(content: string): string {
    // Remove action blocks for cleaner display
    const cleaned = content.replace(/```json[\s\S]*?```/g, '').trim();
    // Truncate long messages
    return cleaned.slice(0, 300) + (cleaned.length > 300 ? '...' : '');
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h2 className="text-xl font-bold text-white mb-4">Activity Feed</h2>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="text-gray-500">Waiting for directive...</p>
        ) : (
          visible.map((msg) => {
            const color = ROLE_COLORS[msg.from];
            const label = LAYER_LABELS[msg.from];
            const content = formatContent(msg.content);

            return (
              <div
                key={msg.id}
                className="bg-gray-900 rounded px-3 py-2 border border-gray-700 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span className="text-xs text-gray-500 mt-0.5 min-w-[3rem]">
                    {formatRelativeTime(msg.timestamp)}
                  </span>
                  <span className={`font-semibold ${color} min-w-[5rem]`}>
                    [{label}]
                  </span>
                  <p className="text-sm text-gray-300 flex-1 break-words">
                    {content}
                  </p>
                </div>
                {msg.costUsd > 0 && (
                  <div className="text-xs text-gray-500 mt-1 ml-[8.5rem]">
                    Cost: ${msg.costUsd.toFixed(4)} · Duration: {(msg.durationMs / 1000).toFixed(1)}s
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
