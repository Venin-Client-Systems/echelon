#!/usr/bin/env node

import { parseArgs } from './cli.js';
import type { CliResult } from './cli.js';
import { loadConfig } from './lib/config.js';
import { logger } from './lib/logger.js';
import { Orchestrator } from './core/orchestrator.js';
import { loadState, findLatestSession } from './core/state.js';

const VALID_APPROVAL_MODES = new Set(['destructive', 'all', 'none']);

async function runOrchestrator(opts: CliResult & { command: 'run' }): Promise<void> {
  const cliOpts = opts.options;

  if (cliOpts.verbose) {
    logger.setLevel('debug');
  }

  // Validate config path
  if (!cliOpts.config) {
    console.error('Error: --config <path> is required. Run `echelon init` to generate one.');
    process.exit(1);
  }

  // Load config
  const config = loadConfig(cliOpts.config);

  // Override approval mode if specified (with validation)
  if (cliOpts.approvalMode) {
    if (!VALID_APPROVAL_MODES.has(cliOpts.approvalMode)) {
      console.error(`Error: Invalid approval mode "${cliOpts.approvalMode}". Must be: destructive, all, or none`);
      process.exit(1);
    }
    (config as { approvalMode: string }).approvalMode = cliOpts.approvalMode;
  }

  // Resume or create new
  let state;
  if (cliOpts.resume) {
    const sessionId = findLatestSession(config.project.repo);
    if (sessionId) {
      state = loadState(sessionId);
      if (state) {
        logger.info('Resuming session', { session: sessionId });
      } else {
        logger.warn('Could not load session state, starting fresh');
      }
    } else {
      logger.warn('No previous session found, starting fresh');
    }
  }

  const orchestrator = new Orchestrator({
    config,
    cliOptions: cliOpts,
    state: state ?? undefined,
  });

  if (cliOpts.headless || cliOpts.dryRun) {
    const directive = cliOpts.directive;
    if (!directive && !cliOpts.resume) {
      console.error('Error: --directive is required in headless/dry-run mode (unless resuming)');
      process.exit(1);
    }

    if (directive) {
      await orchestrator.runCascade(directive);
    } else if (state) {
      await orchestrator.runCascade(state.directive);
    }

    const pending = orchestrator.executor.getPending();
    if (pending.length > 0 && config.approvalMode !== 'none') {
      logger.info(`${pending.length} action(s) pending CEO approval.`);
      for (const p of pending) {
        logger.info(`  - ${p.description}`);
      }
    }
  } else {
    // TUI mode — suppress logger output, Ink owns the terminal
    logger.setQuiet(true);

    const React = await import('react');
    const { render } = await import('ink');
    const { App } = await import('./ui/App.js');

    render(
      React.createElement(App, {
        orchestrator,
        initialDirective: cliOpts.directive,
      }),
    );
  }
}

async function main(): Promise<void> {
  const result = parseArgs(process.argv);

  switch (result.command) {
    case 'init': {
      const { runInit } = await import('./commands/init.js');
      await runInit();
      break;
    }

    case 'sessions': {
      const { printSessions, pruneCompletedSessions, deleteSession } =
        await import('./core/session.js');

      switch (result.action) {
        case 'list':
          printSessions();
          break;
        case 'prune': {
          const count = pruneCompletedSessions();
          console.log(`Pruned ${count} session(s).`);
          break;
        }
        case 'delete': {
          const ok = deleteSession(result.sessionId);
          console.log(ok ? `Deleted session: ${result.sessionId}` : `Session not found: ${result.sessionId}`);
          break;
        }
      }
      break;
    }

    case 'run':
      await runOrchestrator(result);
      break;
  }
}

main().catch((err) => {
  logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
