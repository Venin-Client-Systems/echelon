import React from 'react';
import { Box, Text } from 'ink';
import type { EchelonState } from '../lib/types.js';

interface StatusBarProps {
  cost: number;
  budget: number;
  elapsed: string;
  repo: string;
  status: EchelonState['status'];
  pendingCount: number;
}

const BUDGET_WARN_PERCENT = 0.5;
const BUDGET_DANGER_PERCENT = 0.8;

const STATUS_COLORS: Record<string, string> = {
  running: 'green',
  paused: 'yellow',
  completed: 'cyan',
  failed: 'red',
};

function costColor(cost: number, budget: number): string {
  if (budget <= 0) return 'white';
  const ratio = cost / budget;
  if (ratio >= BUDGET_DANGER_PERCENT) return 'red';
  if (ratio >= BUDGET_WARN_PERCENT) return 'yellow';
  return 'white';
}

export function StatusBar({ cost, budget, elapsed, repo, status, pendingCount }: StatusBarProps) {
  const budgetPercent = budget > 0 ? Math.round((cost / budget) * 100) : 0;

  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text>
        <Text dimColor>💰 </Text>
        <Text bold color={costColor(cost, budget)}>${cost.toFixed(4)}</Text>
        <Text dimColor>/{budget.toFixed(0)}</Text>
        <Text dimColor> ({budgetPercent}%)</Text>
        <Text dimColor> │ ⏱  </Text>
        <Text color="white">{elapsed}</Text>
        <Text dimColor> │ </Text>
        <Text color={STATUS_COLORS[status] ?? 'white'} bold>{status.toUpperCase()}</Text>
      </Text>
      <Text>
        {pendingCount > 0 && (
          <Text color="yellow" bold>⚠️  {pendingCount} pending │ </Text>
        )}
        <Text dimColor>📦 {repo}</Text>
      </Text>
    </Box>
  );
}
