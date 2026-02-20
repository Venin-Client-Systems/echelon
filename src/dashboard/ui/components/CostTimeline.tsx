import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface CostTimelineProps {
  timeline: Array<{ timestamp: string; totalCost: number }>;
}

/**
 * Line chart displaying cumulative cost over time.
 *
 * Visualizes the `cascadeTimeline` from DashboardMetrics, showing how
 * total cost increases throughout the orchestrator session.
 *
 * Features:
 * - X-axis: Time labels in HH:MM:SS format
 * - Y-axis: Cumulative cost in USD
 * - Hover tooltip: Exact timestamp and cost
 * - Responsive container for auto-resizing
 *
 * @category Dashboard
 *
 * @example
 * ```tsx
 * <CostTimeline timeline={metrics.cascadeTimeline} />
 * ```
 */
export function CostTimeline({ timeline }: CostTimelineProps) {
  // Format timestamp to HH:MM:SS for display
  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  // Transform data for recharts
  const data = timeline.map((entry) => ({
    time: formatTime(entry.timestamp),
    cost: entry.totalCost,
    fullTimestamp: entry.timestamp,
  }));

  // Custom tooltip to show full timestamp
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
          <p style={{ margin: 0, fontWeight: 'bold' }}>
            ${entry.cost.toFixed(4)}
          </p>
          <p style={{ margin: 0, color: '#666', fontSize: '10px' }}>
            {new Date(entry.fullTimestamp).toLocaleString()}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div
      className="cost-timeline"
      style={{ width: '100%', height: '300px' }}
      aria-label="Cost timeline chart showing cumulative cost over time"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="time"
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
            label={{
              value: 'Cost (USD)',
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: '12px', fill: '#6b7280' },
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="cost"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3, fill: '#3b82f6' }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
