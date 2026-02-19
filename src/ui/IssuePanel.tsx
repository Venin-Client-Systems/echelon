import React from 'react';
import { Box, Text } from 'ink';
import type { TrackedIssue } from '../lib/types.js';

interface IssuePanelProps {
  issues: TrackedIssue[];
}

const MAX_TITLE_LEN = 14;

const STATE_ICONS: Record<string, { icon: string; color: string }> = {
  open:   { icon: '▶', color: 'green' },
  closed: { icon: '●', color: 'gray' },
};

export function IssuePanel({ issues }: IssuePanelProps) {
  const visible = issues.slice(-8);

  return (
    <Box flexDirection="column" paddingX={1} width={22}>
      <Text bold color="white">═ Issues ═</Text>
      {visible.length === 0 ? (
        <Text dimColor>None yet</Text>
      ) : (
        visible.map(issue => {
          const { icon, color } = STATE_ICONS[issue.state] ?? STATE_ICONS.open;
          const title = issue.title.length > MAX_TITLE_LEN
            ? issue.title.slice(0, MAX_TITLE_LEN - 1) + '\u2026'
            : issue.title;
          return (
            <Box key={issue.number}>
              <Text dimColor>#{issue.number} </Text>
              <Text>{title} </Text>
              <Text color={color}>{icon}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
