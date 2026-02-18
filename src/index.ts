#!/usr/bin/env node

import { parseArgs } from './cli.js';
import type { CliResult } from './cli.js';
import { loadConfig, discoverConfig, generateDefaultConfig } from './lib/config.js';
import { detectGitRepo } from './lib/git-detect.js';
import { logger } from './lib/logger.js';
import { Orchestrator } from './core/orchestrator.js';
import { loadState, findLatestSession } from './core/state.js';
import type { EchelonConfig } from './lib/types.js';
import { createInterface } from 'node:readline';

const VALID_APPROVAL_MODES = new Set(['destructive', 'all', 'none']);

async function askYesNo(prompt: string, defaultYes = true): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return new Promise(res => {
    rl.question(`${prompt} [${hint}] `, answer => {
      rl.close();
      const a = answer.trim().toLowerCase();
      res(a === '' ? defaultYes : a.startsWith('y'));
    });
  });
}

async function resolveConfig(cliOpts: { config: string; headless: boolean }): Promise<EchelonConfig> {
  // 1. Explicit --config flag
  if (cliOpts.config) {
    return loadConfig(cliOpts.config);
  }

  // 2. Auto-discover config file
  const detected = detectGitRepo();
  const configPath = discoverConfig(detected?.path);

  if (configPath) {
    logger.debug('Auto-discovered config', { path: configPath });
    return loadConfig(configPath);
  }

  // 3. No config file found — try quick setup or in-memory default
  if (detected) {
    const isInteractive = process.stdin.isTTY && !cliOpts.headless;

    if (isInteractive) {
      console.log(`\n  No config found. Detected: \x1b[1m${detected.repo}\x1b[0m`);
      const proceed = await askYesNo('  Run quick setup?');
      if (!proceed) {
        console.log('  Run \x1b[1mechelon init\x1b[0m for full setup.\n');
        process.exit(0);
      }
      const { runQuickInit } = await import('./commands/init.js');
      return runQuickInit(detected);
    }

    // Headless — use in-memory defaults, no file written
    console.error(`  Auto-config for \x1b[1m${detected.repo}\x1b[0m. Run \x1b[1mechelon init\x1b[0m to customize.`);
    return generateDefaultConfig(detected);
  }

  // 4. Not in a git repo at all
  console.error('Error: Not in a git repo. Run from a project directory or use --config <path>.');
  process.exit(1);
}

async function runOrchestrator(opts: CliResult & { command: 'run' }): Promise<void> {
  const cliOpts = opts.options;

  if (cliOpts.verbose) {
    logger.setLevel('debug');
  }

  // Resolve config via flag, auto-discovery, or quick init
  const config = await resolveConfig(cliOpts);

  // Override approval mode if specified (with validation)
  if (cliOpts.approvalMode) {
    if (!VALID_APPROVAL_MODES.has(cliOpts.approvalMode)) {
      console.error(`Error: Invalid approval mode "${cliOpts.approvalMode}". Must be: destructive, all, or none`);
      process.exit(1);
    }
    (config as { approvalMode: string }).approvalMode = cliOpts.approvalMode;
  }

  // YOLO mode — override approval mode and warn
  if (cliOpts.yolo) {
    (config as { approvalMode: string }).approvalMode = 'none';
    logger.warn('YOLO mode — all actions auto-approved, agents run with full permissions');
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

  // Telegram bot mode — start bot and return (bot handles its own lifecycle)
  if (cliOpts.telegram) {
    try {
      const { startBot } = await import('./telegram/bot.js');
      await startBot(config);
    } catch (err) {
      logger.error('Telegram bot failed to start', { error: err instanceof Error ? err.message : String(err) });
      orchestrator.shutdown();
      throw err;
    }
    return;
  }

  if (cliOpts.headless || cliOpts.dryRun) {
    const directive = cliOpts.directive;
    if (!directive && !cliOpts.resume) {
      console.error('Error: --directive is required in headless/dry-run mode (unless resuming)');
      process.exit(1);
    }

    // Install cleanup handler for headless mode
    const cleanup = () => {
      logger.info('Cleaning up orchestrator...');
      orchestrator.shutdown();
    };
    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    try {
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
    } catch (err) {
      logger.error('Cascade failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  } else {
    // TUI mode requires an interactive terminal with raw mode support
    if (!process.stdin.isTTY) {
      console.error('Error: TUI mode requires an interactive terminal.');
      console.error('Use --headless for non-interactive environments, or pipe a directive with -d.');
      process.exit(1);
    }

    // Suppress logger output — Ink owns the terminal
    logger.setQuiet(true);

    try {
      const React = await import('react');
      const { render } = await import('ink');
      const { App } = await import('./ui/App.js');

      render(
        React.createElement(App, {
          orchestrator,
          initialDirective: cliOpts.directive,
        }),
      );
    } catch (err) {
      logger.error('TUI failed to start', { error: err instanceof Error ? err.message : String(err) });
      orchestrator.shutdown();
      throw err;
    }
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
