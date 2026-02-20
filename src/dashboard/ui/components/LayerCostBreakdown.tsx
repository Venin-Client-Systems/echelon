import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { AgentRole } from '../../../lib/types.js';
import { LAYER_LABELS } from '../../../lib/types.js';

interface LayerCostBreakdownProps {
  costByLayer: Record<AgentRole, number>;
}

/**
 * Horizontal bar chart showing cost breakdown by agent layer.
 *
 * Displays cumulative cost for each layer (2IC, Eng Lead, Team Lead).
 * Each bar is color-coded to match the TUI status indicators.
 *
 * Features:
 * - Horizontal bars with cost labels
 * - Color-coded by layer (cyan for 2IC, blue for Eng Lead, green for Team Lead)
 * - Responsive container for auto-resizing
 * - Tooltip showing exact cost on hover
 *
 * @category Dashboard
 *
 * @example
 * ```tsx
 * <LayerCostBreakdown costByLayer={metrics.costByLayer} />
 * ```
 */
export function LayerCostBreakdown({ costByLayer }: LayerCostBreakdownProps) {
  // Layer colors matching TUI theme
  const LAYER_COLORS: Record<string, string> = {
    '2ic': '#06b6d4', // cyan (thinking color in TUI)
    'eng-lead': '#3b82f6', // blue
    'team-lead': '#10b981', // green (executing/done color in TUI)
  };

  // Transform data for recharts (only include layers with costs)
  const data = (['2ic', 'eng-lead', 'team-lead'] as const)
    .map((role) => ({
      layer: LAYER_LABELS[role],
      cost: costByLayer[role] || 0,
      role,
    }))
    .filter((entry) => entry.cost > 0) // Only show layers with non-zero cost
    .sort((a, b) => b.cost - a.cost); // Sort by cost descending

  // Custom label to show cost on bars
  const renderCustomLabel = (props: any) => {
    const { x, y, width, height, value } = props;
    return (
      <text
        x={x + width + 5}
        y={y + height / 2}
        fill="#374151"
        textAnchor="start"
        dominantBaseline="middle"
        style={{ fontSize: '12px', fontWeight: 'bold' }}
      >
        ${value.toFixed(4)}
      </text>
    );
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const entry = payload[0].payload;
      return (
        <div
          style={{
            backgroundColor: 'white',
            border: '1px solid #ccc',
            padding: '8px',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          <p style={{ margin: 0, fontWeight: 'bold' }}>{entry.layer}</p>
          <p style={{ margin: '4px 0 0 0', color: LAYER_COLORS[entry.role] }}>
            Cost: ${entry.cost.toFixed(4)}
          </p>
        </div>
      );
    }
    return null;
  };

  // Handle empty state
  if (data.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          height: '200px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#9ca3af',
          fontSize: '14px',
        }}
      >
        No layer costs yet
      </div>
    );
  }

  return (
    <div
      className="layer-cost-breakdown"
      style={{ width: '100%', height: '250px' }}
      aria-label="Layer cost breakdown showing costs for 2IC, Eng Lead, and Team Lead"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 80, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            type="number"
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
            label={{
              value: 'Cost (USD)',
              position: 'insideBottom',
              style: { fontSize: '12px', fill: '#6b7280' },
            }}
          />
          <YAxis
            type="category"
            dataKey="layer"
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
            width={80}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="cost" label={renderCustomLabel}>
            {data.map((entry) => (
              <Cell key={entry.role} fill={LAYER_COLORS[entry.role]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
