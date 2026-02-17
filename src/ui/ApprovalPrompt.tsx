import React from 'react';
import { Box, Text } from 'ink';
import type { PendingApproval } from '../lib/types.js';

interface ApprovalPromptProps {
  approvals: PendingApproval[];
  onApprove: (id?: string) => void;
  onReject: (id: string, reason: string) => void;
}

export function ApprovalPrompt({ approvals, onApprove, onReject }: ApprovalPromptProps) {
  if (approvals.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginY={0}
    >
      <Text bold color="yellow">
        Pending Approvals ({approvals.length})
      </Text>
      {approvals.map(a => (
        <Box key={a.id}>
          <Text dimColor>[{a.id}] </Text>
          <Text>{a.description}</Text>
        </Box>
      ))}
      <Text dimColor>
        /approve — approve all | /approve {'<id>'} — approve one | /reject {'<id> <reason>'} — reject
      </Text>
    </Box>
  );
}
