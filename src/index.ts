#!/usr/bin/env node

import { parseArgs } from './cli.js';
import type { CliResult } from './cli.js';
import { loadConfig, discoverConfig, generateDefaultConfig } from './lib/config.js';
import { detectGitRepo } from './lib/git-detect.js';
import { logger } from './lib/logger.js';
import { Orchestrator } from './core/orchestrator.js';
import { loadState, findLatestSession } from './core/state.js';
import type { EchelonConfig } from './lib/types.js';
import { LAYER_ORDER } from './lib/types.js';
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

async function askQuestion(prompt: string, defaultValue = ''): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const hint = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise(res => {
    rl.question(`${prompt}${hint}: `, answer => {
      rl.close();
      res(answer.trim() || defaultValue);
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
  console.error('\n  \x1b[31m✗\x1b[0m Not in a git repository.\n');
  console.error('  \x1b[1mQuick fix:\x1b[0m');
  console.error('    cd /path/to/your/project  # Navigate to your project');
  console.error('    echelon -d "your directive"');
  console.error('\n  \x1b[1mOr:\x1b[0m Use --config to specify a config file:');
  console.error('    echelon --config /path/to/echelon.config.json -d "your directive"\n');
  process.exit(1);
}

/**
 * Smart interactive mode - just type 'echelon' and it handles everything.
 * Detects context and guides the user through the right workflow.
 */
async function runInteractiveMode(yolo = false): Promise<void> {
  const detected = detectGitRepo();

  if (!detected) {
    console.error('\n  \x1b[31m✗\x1b[0m Not in a git repository.\n');
    console.error('  \x1b[1mQuick fix:\x1b[0m');
    console.error('    cd /path/to/your/project');
    console.error('    echelon\n');
    process.exit(1);
  }

  // Show personalized welcome banner
  const { readFileSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

  console.clear();
  console.log('\n\x1b[1m\x1b[36m' + '═'.repeat(60) + '\x1b[0m');
  console.log('\x1b[1m  VENIN Echelon AI Orchestrator\x1b[0m \x1b[90mv' + packageJson.version + '\x1b[0m');
  console.log('\x1b[36m' + '═'.repeat(60) + '\x1b[0m\n');
  console.log('  📁  Project: \x1b[1m' + detected.repo + '\x1b[0m');
  console.log('  📂  Path: \x1b[90m' + detected.path + '\x1b[0m');
  console.log('  \x1b[90m✨  Built by George Atkinson & Claude Opus 4.6\x1b[0m');
  console.log('  \x1b[90m📧  george.atkinson@venin.space\x1b[0m');
  console.log('  \x1b[90m💡  Tip: Run \x1b[1mechelon --help\x1b[0m\x1b[90m for all commands\x1b[0m\n');

  // Check for existing config
  const configPath = discoverConfig(detected.path);
  let config: EchelonConfig;

  if (!configPath) {
    // First time - run setup
    console.log('  \x1b[33m⚠️  No configuration found\x1b[0m\n');
    console.log('  Let\'s set up Echelon for this project (takes 30 seconds).\n');

    const proceed = await askYesNo('  Ready to start setup?');
    if (!proceed) {
      console.log('\n  Run \x1b[1mechelon\x1b[0m anytime to start.\n');
      process.exit(0);
    }

    const { runQuickInit } = await import('./commands/init.js');
    config = await runQuickInit(detected);
    console.log('\n  \x1b[32m✓\x1b[0m Setup complete!\n');
  } else {
    // Load existing config
    config = loadConfig(configPath);

    // Override approval mode if yolo
    if (yolo) {
      (config as { approvalMode: string }).approvalMode = 'none';
      console.log('  \x1b[32m✓\x1b[0m Configuration loaded\x1b[0m');
      console.log('  💰  Budget: $' + config.maxTotalBudgetUsd.toFixed(2) + ' | \x1b[33mYOLO MODE\x1b[0m 🚀\n');
    } else {
      console.log('  \x1b[32m✓\x1b[0m Configuration loaded\x1b[0m');
      console.log('  💰  Budget: $' + config.maxTotalBudgetUsd.toFixed(2) + ' | Approval: ' + config.approvalMode + '\n');
    }
  }

  // Check for existing session
  const sessionId = findLatestSession(detected.repo);
  let shouldResume = false;

  if (sessionId) {
    const state = loadState(sessionId);
    if (state && state.status !== 'completed') {
      console.log('  \x1b[33m📋  Active session found\x1b[0m');
      console.log('  Status: ' + state.status + ' | Cost: $' + state.totalCost.toFixed(4));
      console.log('  Directive: ' + state.directive.slice(0, 50) + (state.directive.length > 50 ? '...' : '') + '\n');

      shouldResume = await askYesNo('  Resume this session?');
      console.log();
    }
  }

  let directive = '';

  if (!shouldResume) {
    // Ask for new directive with helpful examples
    console.log('  \x1b[1m💡  What should Echelon build?\x1b[0m\n');
    console.log('  \x1b[90mExamples:\x1b[0m');
    console.log('    • "Add JWT authentication to the API"');
    console.log('    • "Fix all issues labeled bug-critical"');
    console.log('    • "Implement dark mode for the dashboard"');
    console.log('    • "Add unit tests for the auth module"\n');

    directive = await askQuestion('  Your directive');

    if (!directive) {
      console.log('\n  \x1b[33m⚠️  No directive provided. Run \x1b[1mechelon\x1b[0m when ready.\n');
      process.exit(0);
    }

    console.log();
  }

  // Show pre-flight checklist
  console.log('\x1b[36m' + '─'.repeat(60) + '\x1b[0m');
  console.log('  \x1b[1m🚀  Ready to launch cascade\x1b[0m\n');
  if (shouldResume) {
    console.log('  Mode: \x1b[33mResume session\x1b[0m');
  } else {
    console.log('  Mode: \x1b[32mNew cascade\x1b[0m');
    console.log('  Directive: ' + directive.slice(0, 60) + (directive.length > 60 ? '...' : ''));
  }
  console.log('  Budget: $' + config.maxTotalBudgetUsd.toFixed(2));
  if (yolo) {
    console.log('  Approval: \x1b[33mYOLO MODE - Full autonomous\x1b[0m 🚀');
  } else {
    console.log('  Approval: ' + config.approvalMode + (config.approvalMode === 'destructive' ? ' (you\'ll approve actions)' : ''));
  }
  console.log('\x1b[36m' + '─'.repeat(60) + '\x1b[0m\n');

  const confirm = await askYesNo('  Start now?');
  if (!confirm) {
    console.log('\n  Cancelled. Run \x1b[1mechelon\x1b[0m when ready.\n');
    process.exit(0);
  }

  console.log();

  // Give user 1 second to read pre-flight info before clearing
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Create orchestrator and run
  const state = shouldResume && sessionId ? loadState(sessionId) : undefined;
  const orchestrator = new Orchestrator({
    config,
    cliOptions: {
      config: configPath || '',
      directive,
      headless: false,
      dryRun: false,
      resume: shouldResume,
      verbose: false,
      telegram: false,
      yolo,
    },
    state: state ?? undefined,
  });

  // TUI mode
  if (process.stdin.isTTY) {
    logger.setQuiet(true);

    // Clear pre-flight info before TUI starts
    console.clear();

    const React = await import('react');
    const { render } = await import('ink');
    const { App } = await import('./ui/App.js');

    const { unmount: _unmount } = render(
      React.createElement(App, {
        orchestrator,
        initialDirective: shouldResume ? undefined : directive,
      }),
      {
        patchConsole: false,
        exitOnCtrlC: false,
      },
    );
  } else {
    // Fallback to headless if not TTY
    if (directive || state) {
      await orchestrator.runCascade(directive || state!.directive);
    }
  }
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
      console.error('\n  \x1b[31m✗\x1b[0m Missing directive in headless mode.\n');
      console.error('  \x1b[1mExamples:\x1b[0m');
      console.error('    echelon --headless -d "Implement user authentication"');
      console.error('    echelon --dry-run -d "Fix bug #42"');
      console.error('    echelon --resume  # Resume previous session\n');
      process.exit(1);
    }

    // Show banner for headless mode
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

    console.log('\n\x1b[1m\x1b[36mVENIN Echelon v' + packageJson.version + '\x1b[0m ' + (cliOpts.dryRun ? '(dry-run)' : '(headless)'));
    console.log('\x1b[36m' + '─'.repeat(60) + '\x1b[0m');
    console.log('Project: ' + config.project.repo);
    console.log('Budget: $' + config.maxTotalBudgetUsd.toFixed(2) + ' | Approval: ' + config.approvalMode);
    if (directive) {
      console.log('Directive: ' + directive.slice(0, 70) + (directive.length > 70 ? '...' : ''));
    }
    console.log('\x1b[36m' + '─'.repeat(60) + '\x1b[0m\n');

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

    // Show welcome banner before TUI starts
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

    console.clear();
    console.log('\n\x1b[1m\x1b[36m' + '═'.repeat(60) + '\x1b[0m');
    console.log('\x1b[1m  VENIN Echelon AI Orchestrator\x1b[0m \x1b[90mv' + packageJson.version + '\x1b[0m');
    console.log('\x1b[36m' + '═'.repeat(60) + '\x1b[0m\n');
    console.log('  \x1b[32m●\x1b[0m  Hierarchical multi-agent cascade ready');
    console.log('  \x1b[32m●\x1b[0m  Budget: $' + config.maxTotalBudgetUsd.toFixed(2) + ' | Approval: ' + config.approvalMode);
    console.log('  \x1b[32m●\x1b[0m  Project: ' + config.project.repo);
    console.log('  \x1b[90m✨  Built by George Atkinson & Claude Opus 4.6\x1b[0m\n');
    console.log('  \x1b[90m💡 Quick Tips:\x1b[0m');
    console.log('     Ctrl+C to pause (resumes with --resume)');
    console.log('     Use Tab/Arrow keys to navigate approvals');
    console.log('     Run `echelon` anytime to check status or resume\n');
    console.log('\x1b[36m' + '═'.repeat(60) + '\x1b[0m\n');

    // Give user 1 second to read banner before clearing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Suppress logger output — Ink owns the terminal
    logger.setQuiet(true);

    // Clear banner before TUI starts
    console.clear();

    try {
      const React = await import('react');
      const { render } = await import('ink');
      const { App } = await import('./ui/App.js');

      const { unmount: _unmount } = render(
        React.createElement(App, {
          orchestrator,
          initialDirective: cliOpts.directive,
        }),
        {
          patchConsole: false,
          exitOnCtrlC: false,
        },
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
    case 'interactive': {
      // Smart interactive mode - just type 'echelon'
      await runInteractiveMode(result.yolo);
      break;
    }

    case 'init': {
      const { runInit } = await import('./commands/init.js');
      await runInit();
      break;
    }

    case 'tutorial': {
      const { runTutorial } = await import('./commands/tutorial.js');
      await runTutorial();
      break;
    }

    case 'status': {
      const detected = detectGitRepo();
      if (!detected) {
        console.error('\n  \x1b[31m✗\x1b[0m Status requires a git repository.\n');
        console.error('  \x1b[1mTip:\x1b[0m Navigate to your project directory first:');
        console.error('    cd /path/to/your/project');
        console.error('    echelon status\n');
        process.exit(1);
      }

      const sessionId = findLatestSession(detected.repo);
      if (!sessionId) {
        console.log('\n  No active session found.\n');
        process.exit(0);
      }

      const state = loadState(sessionId);
      if (!state) {
        console.error(`  Error: Could not load session ${sessionId}`);
        process.exit(1);
      }

      // Calculate metrics
      const now = Date.now();
      const startedMs = new Date(state.startedAt).getTime();
      const elapsedMs = now - startedMs;
      const elapsedMin = Math.floor(elapsedMs / 60000);
      const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);

      // Count pending approvals (would need executor, so skip for now)
      const pendingCount = 0; // TODO: Load from executor state if saved

      // Format output
      console.log('\n\x1b[1m  Echelon Status\x1b[0m');
      console.log(`  ─────────────────────────────────────────────────────`);
      console.log(`  Session:     ${sessionId}`);
      console.log(`  Status:      ${state.status === 'running' ? '\x1b[32m●\x1b[0m running' : state.status === 'paused' ? '\x1b[33m●\x1b[0m paused' : state.status === 'completed' ? '\x1b[32m✓\x1b[0m completed' : '\x1b[31m✗\x1b[0m failed'}`);
      console.log(`  Directive:   ${state.directive.slice(0, 60)}${state.directive.length > 60 ? '...' : ''}`);
      console.log(`  Total Cost:  $${state.totalCost.toFixed(4)}`);
      console.log(`  Elapsed:     ${elapsedMin}m ${elapsedSec}s`);
      console.log(`  ─────────────────────────────────────────────────────`);
      console.log(`  Messages:    ${state.messages.length}`);
      console.log(`  Issues:      ${state.issues.length}`);
      console.log(`  Pending:     ${pendingCount} approval(s)`);
      console.log(`  ─────────────────────────────────────────────────────`);
      console.log(`  \x1b[1mAgent States:\x1b[0m`);

      const statusEmoji = (status: string) => {
        switch (status) {
          case 'idle': return '\x1b[90m○\x1b[0m';
          case 'thinking': return '\x1b[33m●\x1b[0m';
          case 'done': return '\x1b[32m✓\x1b[0m';
          case 'error': return '\x1b[31m✗\x1b[0m';
          default: return '○';
        }
      };

      for (const role of LAYER_ORDER) {
        const agent = state.agents[role];
        const cost = agent.totalCost > 0 ? `$${agent.totalCost.toFixed(4)}` : '--';
        const turns = agent.turnsCompleted > 0 ? `${agent.turnsCompleted} turns` : '--';
        console.log(`    ${statusEmoji(agent.status)} ${role.padEnd(12)} ${cost.padEnd(10)} ${turns}`);
      }

      console.log(`  ─────────────────────────────────────────────────────\n`);
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
