import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import type { EchelonState } from '../../lib/types.js';
import { LAYER_LABELS } from '../../lib/types.js';

interface MetricsPanelProps {
  state: EchelonState;
}

const COLORS = ['#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];

export function MetricsPanel({ state }: MetricsPanelProps) {
  // Compute metrics
  const metrics = useMemo(() => {
    // Cost timeline (last 20 messages with costs)
    const costTimeline = state.messages
      .filter(m => m.costUsd > 0)
      .slice(-20)
      .map((m, i) => ({
        index: i,
        cost: m.costUsd,
        timestamp: new Date(m.timestamp).toLocaleTimeString(),
      }));

    // Issues by domain
    const issuesByDomain: Record<string, number> = {};
    state.issues.forEach(issue => {
      issue.labels.forEach(label => {
        if (label.startsWith('ralphy-')) return; // skip ralphy batch labels
        issuesByDomain[label] = (issuesByDomain[label] || 0) + 1;
      });
    });

    const domainData = Object.entries(issuesByDomain).map(([name, value]) => ({ name, value }));

    // Issues by status
    const openIssues = state.issues.filter(i => i.state === 'open').length;
    const closedIssues = state.issues.filter(i => i.state === 'closed').length;

    // Cost by layer
    const costByLayer = Object.entries(state.agents).map(([role, agent]) => ({
      role: LAYER_LABELS[role as keyof typeof LAYER_LABELS],
      cost: agent.totalCost,
    }));

    // Budget usage
    const budgetPercent = (state.totalCost / 50.0) * 100; // Assuming 50 USD max budget

    return {
      costTimeline,
      domainData,
      openIssues,
      closedIssues,
      costByLayer,
      budgetPercent,
    };
  }, [state]);

  return (
    <div className="space-y-6">
      {/* Budget Gauge */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Budget Usage</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Total Cost</span>
            <span className="text-2xl font-mono text-cyan-400">${state.totalCost.toFixed(2)}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-4">
            <div
              className={`h-4 rounded-full transition-all ${
                metrics.budgetPercent > 90 ? 'bg-red-500' :
                metrics.budgetPercent > 70 ? 'bg-yellow-500' :
                'bg-cyan-500'
              }`}
              style={{ width: `${Math.min(metrics.budgetPercent, 100)}%` }}
            ></div>
          </div>
          <div className="text-sm text-gray-400 text-right">
            {metrics.budgetPercent.toFixed(1)}% of $50.00 budget
          </div>
        </div>
      </div>

      {/* Cost Timeline */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Cost Timeline</h3>
        {metrics.costTimeline.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={metrics.costTimeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="index" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                labelStyle={{ color: '#9ca3af' }}
              />
              <Line type="monotone" dataKey="cost" stroke="#06b6d4" strokeWidth={2} dot={{ fill: '#06b6d4' }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-500 text-center py-8">No cost data yet</p>
        )}
      </div>

      {/* Issues Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* By Domain */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h3 className="text-lg font-bold text-white mb-4">Issues by Domain</h3>
          {metrics.domainData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={metrics.domainData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={60}
                  label
                >
                  {metrics.domainData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-center py-8">No issues created yet</p>
          )}
        </div>

        {/* By Status */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h3 className="text-lg font-bold text-white mb-4">Issue Status</h3>
          <div className="space-y-4 py-6">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Open</span>
              <span className="text-3xl font-mono text-cyan-400">{metrics.openIssues}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Closed</span>
              <span className="text-3xl font-mono text-green-400">{metrics.closedIssues}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-700 pt-3">
              <span className="text-gray-400 font-semibold">Total</span>
              <span className="text-3xl font-mono text-white">{state.issues.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
