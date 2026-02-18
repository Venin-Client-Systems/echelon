import React from 'react';
import { Box, Text } from 'ink';
import type { FeedEntry } from './hooks/useEchelon.js';
import { formatRelativeTime } from '../lib/time.js';

interface FeedProps {
  entries: FeedEntry[];
  maxLines?: number;
}

export function Feed({ entries, maxLines = 20 }: FeedProps) {
  const visible = entries.slice(-maxLines);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      flexGrow={1}
    >
      <Text bold color="white">Feed</Text>
      {visible.length === 0 ? (
        <Text dimColor>Waiting for directive...</Text>
      ) : (
        visible.map(entry => (
          <Box key={entry.id} flexWrap="wrap">
            <Text dimColor>{formatRelativeTime(entry.timestamp)} </Text>
            <Text color={entry.color} bold>[{entry.source}] </Text>
            <Text wrap="truncate-end">{entry.text}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
