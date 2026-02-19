import type { EchelonState, AgentRole } from './types.js';

/**
 * Session analytics and metrics calculation.
 * Provides insights into cascade performance, costs, and efficiency.
 */

export interface SessionMetrics {
  // Overall metrics
  totalCost: number;
  totalDuration: number;
  status: string;
  directive: string;

  // Layer breakdown
  layerMetrics: {
    role: AgentRole;
    cost: number;
    turns: number;
    avgCostPerTurn: number;
    status: string;
  }[];

  // Action metrics
  actionsExecuted: number;
  actionBreakdown: Record<string, number>;
  issuesCreated: number;
  pendingApprovals: number;

  // Efficiency metrics
  costPerIssue: number;
  avgTurnDuration: number;
  successRate: number;
}

/**
 * Calculate comprehensive metrics from session state.
 */
export function calculateSessionMetrics(state: EchelonState): SessionMetrics {
  // Use updatedAt for completed/failed sessions, current time for running
  const endTime = (state.status === 'completed' || state.status === 'failed')
    ? new Date(state.updatedAt).getTime()
    : Date.now();
  const duration = endTime - new Date(state.startedAt).getTime();

  // Layer metrics
  const layerMetrics = Object.entries(state.agents).map(([role, agent]) => ({
    role: role as AgentRole,
    cost: agent.totalCost,
    turns: agent.turnsCompleted,
    avgCostPerTurn: agent.turnsCompleted > 0 ? agent.totalCost / agent.turnsCompleted : 0,
    status: agent.status,
  }));

  // Action breakdown
  const actionBreakdown: Record<string, number> = {};
  for (const msg of state.messages) {
    if (msg.actions) {
      for (const action of msg.actions) {
        actionBreakdown[action.action] = (actionBreakdown[action.action] || 0) + 1;
      }
    }
  }

  const actionsExecuted = Object.values(actionBreakdown).reduce((sum, count) => sum + count, 0);

  // Efficiency metrics
  const costPerIssue = state.issues.length > 0 ? state.totalCost / state.issues.length : 0;
  const totalTurns = layerMetrics.reduce((sum, l) => sum + l.turns, 0);
  const avgTurnDuration = totalTurns > 0 ? duration / totalTurns : 0;

  // Success rate (based on completed vs failed status)
  const successRate = state.status === 'completed' ? 100 :
                     state.status === 'failed' ? 0 :
                     state.status === 'paused' ? 50 : 0;

  return {
    totalCost: state.totalCost,
    totalDuration: duration,
    status: state.status,
    directive: state.directive,
    layerMetrics,
    actionsExecuted,
    actionBreakdown,
    issuesCreated: state.issues.length,
    pendingApprovals: 0, // Pending approvals are not persisted in state
    costPerIssue,
    avgTurnDuration,
    successRate,
  };
}

/**
 * Format session metrics for display.
 */
export function formatSessionMetrics(metrics: SessionMetrics): string {
  const lines: string[] = [];

  // Header
  lines.push('═══════════════════════════════════════');
  lines.push('  SESSION ANALYTICS');
  lines.push('═══════════════════════════════════════');
  lines.push('');

  // Overall metrics
  lines.push('OVERALL METRICS:');
  lines.push(`  Status: ${metrics.status}`);
  lines.push(`  Total Cost: $${metrics.totalCost.toFixed(4)}`);
  lines.push(`  Duration: ${formatDuration(metrics.totalDuration)}`);
  lines.push(`  Success Rate: ${metrics.successRate.toFixed(0)}%`);
  lines.push('');

  // Layer breakdown
  lines.push('LAYER BREAKDOWN:');
  for (const layer of metrics.layerMetrics) {
    lines.push(`  ${layer.role}:`);
    lines.push(`    Cost: $${layer.cost.toFixed(4)}`);
    lines.push(`    Turns: ${layer.turns}`);
    lines.push(`    Avg/turn: $${layer.avgCostPerTurn.toFixed(4)}`);
    lines.push(`    Status: ${layer.status}`);
  }
  lines.push('');

  // Action metrics
  lines.push('ACTION METRICS:');
  lines.push(`  Total Actions: ${metrics.actionsExecuted}`);
  lines.push(`  Issues Created: ${metrics.issuesCreated}`);
  if (metrics.issuesCreated > 0) {
    lines.push(`  Cost/Issue: $${metrics.costPerIssue.toFixed(4)}`);
  }
  lines.push('');

  // Action breakdown
  if (Object.keys(metrics.actionBreakdown).length > 0) {
    lines.push('ACTION TYPES:');
    for (const [action, count] of Object.entries(metrics.actionBreakdown).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${action}: ${count}`);
    }
    lines.push('');
  }

  // Efficiency insights
  lines.push('EFFICIENCY:');
  lines.push(`  Avg Turn Duration: ${formatDuration(metrics.avgTurnDuration)}`);
  if (metrics.totalCost > 0) {
    const costEfficiency = metrics.issuesCreated / metrics.totalCost;
    lines.push(`  Issues/$: ${costEfficiency.toFixed(2)}`);
  }
  lines.push('');

  lines.push('═══════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Format duration in human-readable format.
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Compare two sessions and show performance delta.
 */
export function compareSessionMetrics(current: SessionMetrics, previous: SessionMetrics): string {
  const lines: string[] = [];

  lines.push('SESSION COMPARISON:');
  lines.push('');

  // Cost comparison
  const costDelta = current.totalCost - previous.totalCost;
  const costPercent = ((costDelta / previous.totalCost) * 100).toFixed(1);
  lines.push(`  Cost: $${current.totalCost.toFixed(4)} (${costDelta >= 0 ? '+' : ''}$${costDelta.toFixed(4)}, ${costPercent}%)`);

  // Duration comparison
  const durationDelta = current.totalDuration - previous.totalDuration;
  const durationPercent = ((durationDelta / previous.totalDuration) * 100).toFixed(1);
  lines.push(`  Duration: ${formatDuration(current.totalDuration)} (${durationDelta >= 0 ? '+' : ''}${formatDuration(durationDelta)}, ${durationPercent}%)`);

  // Issue count comparison
  const issueDelta = current.issuesCreated - previous.issuesCreated;
  lines.push(`  Issues: ${current.issuesCreated} (${issueDelta >= 0 ? '+' : ''}${issueDelta})`);

  // Efficiency comparison
  const currentEfficiency = current.issuesCreated / current.totalCost;
  const previousEfficiency = previous.issuesCreated / previous.totalCost;
  const efficiencyDelta = ((currentEfficiency - previousEfficiency) / previousEfficiency * 100).toFixed(1);
  lines.push(`  Efficiency: ${currentEfficiency.toFixed(2)} issues/$ (${efficiencyDelta}%)`);

  return lines.join('\n');
}
