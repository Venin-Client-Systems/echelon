import React from 'react';
import { Box, Text } from 'ink';
import type { AgentRole, AgentStatus } from '../lib/types.js';
import { LAYER_ORDER, LAYER_LABELS } from '../lib/types.js';

interface OrgChartProps {
  agents: Record<AgentRole, { status: AgentStatus; cost: number }>;
}

const STATUS_ICONS: Record<AgentStatus, { icon: string; color: string }> = {
  idle:      { icon: '○', color: 'gray' },
  thinking:  { icon: '◆', color: 'cyan' },
  executing: { icon: '▶', color: 'green' },
  waiting:   { icon: '⏳', color: 'yellow' },
  error:     { icon: '✗', color: 'red' },
  done:      { icon: '●', color: 'green' },
};

const MAX_LABEL_LEN = Math.max(...LAYER_ORDER.map(r => LAYER_LABELS[r].length));

export function OrgChart({ agents }: OrgChartProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={22}>
      <Text bold color="white">Org</Text>
      {LAYER_ORDER.map(role => {
        const agent = agents[role];
        const { icon, color } = STATUS_ICONS[agent.status];
        const label = LAYER_LABELS[role].padEnd(MAX_LABEL_LEN);
        const cost = agent.cost > 0 ? ` $${agent.cost.toFixed(2)}` : '';
        return (
          <Box key={role}>
            <Text color={color}>{icon} </Text>
            <Text>{label}</Text>
            <Text dimColor>{cost}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
