import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface BudgetGaugeProps {
  current: number;
  max: number;
}

/**
 * Radial gauge component displaying budget utilization.
 *
 * Shows percentage-based visual indicator with color zones:
 * - Green (< 75%): Healthy budget
 * - Yellow (75-90%): Warning zone
 * - Red (> 90%): Critical zone
 *
 * @category Dashboard
 *
 * @example
 * ```tsx
 * <BudgetGauge current={3.75} max={5.0} />
 * ```
 */
export function BudgetGauge({ current, max }: BudgetGaugeProps) {
  const percentage = max > 0 ? (current / max) * 100 : 0;
  const color = percentage < 75 ? '#10b981' : percentage < 90 ? '#f59e0b' : '#ef4444';

  const data = [
    { name: 'Used', value: current },
    { name: 'Remaining', value: Math.max(max - current, 0) },
  ];

  return (
    <div
      className="budget-gauge"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
      }}
    >
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius={60}
            outerRadius={80}
            startAngle={180}
            endAngle={0}
            aria-label={`Budget gauge showing ${percentage.toFixed(1)}% utilized`}
          >
            <Cell fill={color} />
            <Cell fill="#e5e7eb" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div
        className="gauge-label"
        style={{
          textAlign: 'center',
          marginTop: '-40px',
          fontSize: '14px',
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: 'bold', color }}>
          ${current.toFixed(2)} / ${max.toFixed(2)}
        </div>
        <div
          style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color,
            marginTop: '4px',
          }}
        >
          {percentage.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
