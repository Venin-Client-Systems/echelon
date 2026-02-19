import type { EchelonState, AgentRole, EchelonEvent } from '../lib/types.js';

/**
 * Pre-computed dashboard metrics derived from raw orchestrator state.
 *
 * Prevents clients from doing heavy calculations and enables efficient
 * delta updates via WebSocket events.
 *
 * @category Dashboard
 */
export interface DashboardMetrics {
  /** Cumulative cost per agent layer */
  costByLayer: Record<AgentRole, number>;
  /** Issue count by domain label (excludes cheenoski-* batch labels) */
  issuesByDomain: Record<string, number>;
  /** Open vs closed issue count */
  issuesByStatus: { open: number; closed: number };
  /** Cost over time (last 100 entries) */
  cascadeTimeline: Array<{ timestamp: string; totalCost: number }>;
  /** List of agents currently thinking or executing */
  activeAgents: AgentRole[];
  /** Total issue count */
  totalIssues: number;
  /** Total message count */
  totalMessages: number;
}

/**
 * State aggregation layer for dashboard metrics.
 *
 * Transforms raw orchestrator state into pre-computed rollups cached in memory.
 * Recomputes metrics on state change events to prevent expensive recalculations
 * per API request.
 *
 * @category Dashboard
 *
 * @example
 * ```typescript
 * import { MetricsAggregator } from './dashboard/aggregator.js';
 *
 * const aggregator = new MetricsAggregator(orchestrator.state);
 *
 * // Subscribe to state changes
 * bus.onEchelon((event) => aggregator.handleEvent(event, orchestrator.state));
 *
 * // Get cached metrics
 * const metrics = aggregator.getMetrics();
 * ```
 */
export class MetricsAggregator {
  private metrics: DashboardMetrics;

  /**
   * Create a new metrics aggregator with initial state.
   *
   * @param initialState - Current orchestrator state
   */
  constructor(initialState: EchelonState) {
    this.metrics = this.compute(initialState);
  }

  /**
   * Compute dashboard metrics from orchestrator state.
   *
   * Performs all aggregation calculations:
   * - Sum costs by agent role
   * - Group issues by domain labels (excludes cheenoski-* labels)
   * - Count open vs closed issues
   * - Identify active agents (thinking or executing)
   *
   * @param state - Current orchestrator state
   * @returns Computed metrics
   */
  private compute(state: EchelonState): DashboardMetrics {
    // Aggregate costs by layer
    const costByLayer = {} as Record<AgentRole, number>;
    for (const [role, agent] of Object.entries(state.agents)) {
      costByLayer[role as AgentRole] = agent.totalCost;
    }

    // Group issues by domain label (exclude cheenoski-* batch labels)
    const issuesByDomain: Record<string, number> = {};
    for (const issue of state.issues) {
      for (const label of issue.labels) {
        // Skip batch labels like cheenoski-59797-123, ralphy-0, etc.
        if (!label.startsWith('cheenoski-') && !label.startsWith('ralphy-')) {
          issuesByDomain[label] = (issuesByDomain[label] || 0) + 1;
        }
      }
    }

    // Count open vs closed issues
    const issuesByStatus = {
      open: state.issues.filter((i) => i.state === 'open').length,
      closed: state.issues.filter((i) => i.state === 'closed').length,
    };

    // Identify active agents (thinking or executing)
    const activeAgents: AgentRole[] = [];
    for (const [role, agent] of Object.entries(state.agents)) {
      if (agent.status === 'thinking' || agent.status === 'executing') {
        activeAgents.push(role as AgentRole);
      }
    }

    return {
      costByLayer,
      issuesByDomain,
      issuesByStatus,
      cascadeTimeline: this.metrics?.cascadeTimeline || [],
      activeAgents,
      totalIssues: state.issues.length,
      totalMessages: state.messages.length,
    };
  }

  /**
   * Handle MessageBus events and recompute metrics as needed.
   *
   * Responds to state-changing events:
   * - `cost_update` — Recompute and append to timeline
   * - `issue_created` — Recompute issue metrics
   * - `agent_status` — Recompute active agents
   * - `message` — Recompute message count
   *
   * @param event - EchelonEvent from MessageBus
   * @param state - Current orchestrator state
   */
  handleEvent(event: EchelonEvent, state: EchelonState): void {
    // Recompute on state-changing events
    if (
      event.type === 'cost_update' ||
      event.type === 'issue_created' ||
      event.type === 'agent_status' ||
      event.type === 'message'
    ) {
      this.metrics = this.compute(state);
    }

    // Append to timeline on cost updates
    if (event.type === 'cost_update') {
      this.metrics.cascadeTimeline.push({
        timestamp: new Date().toISOString(),
        totalCost: event.totalUsd,
      });

      // Cap timeline at 100 entries to prevent unbounded memory growth
      if (this.metrics.cascadeTimeline.length > 100) {
        this.metrics.cascadeTimeline = this.metrics.cascadeTimeline.slice(-100);
      }
    }
  }

  /**
   * Get current cached metrics.
   *
   * Returns pre-computed aggregations without recalculating.
   * Suitable for serving via REST API with < 10ms latency.
   *
   * @returns Current dashboard metrics
   */
  getMetrics(): DashboardMetrics {
    return this.metrics;
  }
}
