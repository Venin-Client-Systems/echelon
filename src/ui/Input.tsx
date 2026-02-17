import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function Input({ onSubmit, disabled }: InputProps) {
  const [value, setValue] = useState('');
  const valueRef = useRef('');
  const isRawSupported = process.stdin.isTTY && typeof process.stdin.setRawMode === 'function';

  useInput((input, key) => {
    // Collect printable chars (even when disabled, to detect /quit)
    if (input) {
      for (const ch of input) {
        if (ch.charCodeAt(0) >= 32) {
          valueRef.current += ch;
        }
      }
    }

    // Check for submit: key.return (raw \r) OR \n/\r in input (line-buffered/PTY)
    const hasNewline = input ? (input.includes('\r') || input.includes('\n')) : false;
    if (key.return || hasNewline) {
      const trimmed = valueRef.current.trim();
      valueRef.current = '';
      setValue('');
      if (trimmed) onSubmit(trimmed);
      return;
    }

    // When disabled, accept chars silently (for /quit) but don't process further
    if (disabled) return;

    if (key.backspace || key.delete) {
      valueRef.current = valueRef.current.slice(0, -1);
      setValue(valueRef.current);
      return;
    }

    // Ignore control sequences, arrow keys, escape
    if (key.ctrl || key.meta || key.escape) return;
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
    if (key.tab) return;

    // Update display for non-return input
    if (input) {
      setValue(valueRef.current);
    }
  }, { isActive: isRawSupported });

  if (disabled) {
    return (
      <Box paddingX={1}>
        <Text dimColor>CEO {'>'} </Text>
        <Text dimColor italic>Session ended</Text>
      </Box>
    );
  }

  if (!isRawSupported) {
    return (
      <Box paddingX={1}>
        <Text dimColor>CEO {'>'} </Text>
        <Text dimColor italic>Input unavailable (no TTY)</Text>
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
