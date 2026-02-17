import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function Input({ onSubmit, disabled }: InputProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) return;

    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setValue('');
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue(prev => prev.slice(0, -1));
      return;
    }

    // Ignore control sequences, arrow keys, escape
    if (key.ctrl || key.meta || key.escape) return;
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
    if (key.tab) return;

    // Only accept printable characters
    if (input && input.length === 1 && input.charCodeAt(0) >= 32) {
      setValue(prev => prev + input);
    }
  });

  if (disabled) {
    return (
      <Box paddingX={1}>
        <Text dimColor>CEO {'>'} </Text>
        <Text dimColor italic>Session ended</Text>
      </Box>
    );
  }

  return (
    <Box paddingX={1}>
      <Text bold color="yellow">CEO {'>'} </Text>
      <Text>{value}</Text>
      <Text dimColor>{'█'}</Text>
    </Box>
  );
}
