import React, { useCallback } from 'react';
import { Box, Text, useApp } from 'ink';
import type { Orchestrator } from '../core/orchestrator.js';
import { useEchelon } from './hooks/useEchelon.js';
import { OrgChart } from './OrgChart.js';
import { Feed } from './Feed.js';
import { IssuePanel } from './IssuePanel.js';
import { StatusBar } from './StatusBar.js';
import { ApprovalPrompt } from './ApprovalPrompt.js';
import { Input } from './Input.js';

interface AppProps {
  orchestrator: Orchestrator;
  initialDirective?: string;
}

export function App({ orchestrator, initialDirective }: AppProps) {
  const { exit } = useApp();
  const echelon = useEchelon(orchestrator);

  // Start cascade if initial directive provided
  React.useEffect(() => {
    if (initialDirective) {
      echelon.sendDirective(initialDirective);
    }
  }, []); // Only run once on mount

  const handleInput = useCallback((input: string) => {
    // Parse commands
    if (input === '/quit' || input === '/q') {
      echelon.shutdown();
      setTimeout(() => { exit(); process.exit(0); }, 200);
      return;
    }

    if (input === '/status' || input === '/s') {
      // Status is always visible in the UI
      return;
    }

    if (input === '/cost') {
      // Cost is always visible in status bar
      return;
    }

    if (input === '/pause') {
      echelon.shutdown();
      return;
    }

    if (input === '/approve' || input === '/a') {
      echelon.approve();
      return;
    }

    if (input.startsWith('/approve ')) {
      const id = input.slice(9).trim();
      echelon.approve(id);
      return;
    }

    if (input.startsWith('/reject ') || input.startsWith('/r ')) {
      const parts = input.replace(/^\/r(eject)?\s+/, '').split(/\s+/);
      const id = parts[0];
      const reason = parts.slice(1).join(' ') || 'Rejected by CEO';
      if (id) echelon.reject(id, reason);
      return;
    }

    // Free text = new directive
    echelon.sendDirective(input);
  }, [echelon, exit]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box justifyContent="space-between" paddingX={1} borderStyle="round" borderColor="cyan">
        <Text bold color="magenta">VENIN</Text>
        <Text bold color="cyan"> Echelon</Text>
        <Text color="gray"> | </Text>
        <Text dimColor>{echelon.directive?.slice(0, 60) || 'No directive'}{echelon.directive && echelon.directive.length > 60 ? '...' : ''}</Text>
      </Box>

      {/* Main area: sidebar + feed */}
      <Box flexGrow={1}>
        {/* Left sidebar */}
        <Box flexDirection="column">
          <OrgChart agents={echelon.agents} />
          <IssuePanel issues={echelon.issues} />
        </Box>

        {/* Feed */}
        <Feed entries={echelon.feed} />
      </Box>

      {/* Approval prompt */}
      <ApprovalPrompt
        approvals={echelon.pendingApprovals}
        onApprove={echelon.approve}
        onReject={echelon.reject}
      />

      {/* Status bar */}
      <StatusBar
        cost={echelon.totalCost}
        budget={orchestrator.config.maxTotalBudgetUsd}
        elapsed={echelon.elapsed}
        repo={echelon.repo}
        status={echelon.status}
        pendingCount={echelon.pendingApprovals.length}
      />

      {/* Input */}
      <Input
        onSubmit={handleInput}
        disabled={echelon.status === 'completed' || echelon.status === 'failed'}
      />
    </Box>
  );
}
