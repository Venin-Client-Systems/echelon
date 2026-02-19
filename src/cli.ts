import { Command } from 'commander';
import type { CliOptions } from './lib/types.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export type CliResult =
  | { command: 'run'; options: CliOptions }
  | { command: 'init' }
  | { command: 'status' }
  | { command: 'tutorial' }
  | { command: 'interactive'; yolo: boolean }
  | { command: 'sessions'; action: 'list' | 'prune'; }
  | { command: 'sessions'; action: 'delete'; sessionId: string }
  | { command: 'analytics'; sessionId?: string };

function addRunOptions(cmd: Command): Command {
  return cmd
    .option('-c, --config <path>', 'Path to echelon.config.json')
    .option('-d, --directive <text>', 'CEO directive to execute')
    .option('--headless', 'Run without TUI (headless mode)', false)
    .option('--dry-run', 'Show planned cascade without executing', false)
    .option('--resume', 'Resume the most recent session', false)
    .option('-v, --verbose', 'Enable debug logging', false)
    .option('--approval-mode <mode>', 'Override approval mode (destructive, all, none)')
    .option('--telegram', 'Start in Telegram bot mode', false)
    .option('--yolo', 'Full autonomous mode — no approvals, no permission prompts', false)
    .option('-y, --yes', 'Auto-approve all actions (alias for --yolo)', false)
    .option('--consolidate', 'Create fewer, larger issues (3-5 instead of 10+) for small teams', false);
}

function toRunResult(cmd: Command): CliResult {
  const opts = cmd.opts();
  // Handle --yes as alias for --yolo
  const yoloMode = opts.yolo || opts.yes;
  return {
    command: 'run',
    options: {
      config: (opts.config ?? '') as string,
      directive: opts.directive as string | undefined,
      headless: opts.headless as boolean,
      dryRun: opts.dryRun as boolean,
      resume: opts.resume as boolean,
      verbose: opts.verbose as boolean,
      telegram: opts.telegram as boolean,
      approvalMode: opts.approvalMode as 'none' | 'destructive' | 'all' | undefined,
      yolo: yoloMode as boolean,
      consolidate: opts.consolidate as boolean,
    },
  };
}

export function parseArgs(argv: string[]): CliResult {
  let result: CliResult | null = null;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(
    readFileSync(join(__dirname, '../package.json'), 'utf-8')
  );

  const program = new Command();

  program
    .name('echelon')
    .description('Hierarchical multi-agent AI org orchestrator')
    .version(packageJson.version)
    .addHelpText('after', `
Quick Start:
  $ echelon              Interactive mode (recommended)
  $ echelon tutorial     First time? Start here! (2 min guide)
  $ echelon --yolo       Full autonomous mode
  $ echelon status       Check current cascade state
  $ echelon --help       Show this help message

Examples:
  $ echelon                                    # Start interactive session
  $ echelon tutorial                           # Learn how Echelon works
  $ echelon --yolo                             # Run with auto-approvals
  $ echelon -d "Add JWT auth" --headless       # Headless mode
  $ echelon status                             # Check progress
  $ echelon sessions list                      # View all sessions

Built by VENIN (George Atkinson & Claude Opus 4.6)
Contact: george.atkinson@venin.space
`);

  // `run` subcommand — `echelon run -d "..." --headless`
  // Also set as default so `echelon -d "..." --headless` works
  const runCmd = addRunOptions(
    program
      .command('run', { isDefault: true })
      .description('Run the orchestrator (default)')
  );
  runCmd.action(() => {
    result = toRunResult(runCmd);
  });

  // Init subcommand
  program
    .command('init')
    .description('Interactive config generator')
    .action(() => {
      result = { command: 'init' };
    });

  // Status subcommand (with 's' alias)
  program
    .command('status')
    .alias('s')
    .description('Show current cascade status')
    .action(() => {
      result = { command: 'status' };
    });

  // Tutorial subcommand
  program
    .command('tutorial')
    .description('Interactive 2-minute tutorial for new users')
    .action(() => {
      result = { command: 'tutorial' };
    });

  // Analytics subcommand
  program
    .command('analytics [session-id]')
    .description('Show detailed session analytics and metrics')
    .action((sessionId?: string) => {
      result = { command: 'analytics', sessionId };
    });

  // Sessions subcommand
  const sessionsCmd = program
    .command('sessions')
    .description('Manage saved sessions');

  sessionsCmd
    .command('list')
    .description('List all sessions')
    .action(() => {
      result = { command: 'sessions', action: 'list' };
    });

  sessionsCmd
    .command('prune')
    .description('Delete completed/failed sessions')
    .action(() => {
      result = { command: 'sessions', action: 'prune' };
    });

  sessionsCmd
    .command('delete <session-id>')
    .description('Delete a specific session')
    .action((sessionId: string) => {
      result = { command: 'sessions', action: 'delete', sessionId };
    });

  // Default for `sessions` with no subcommand = list
  sessionsCmd.action(() => {
    result = { command: 'sessions', action: 'list' };
  });

  program.parse(argv);

  if (!result) {
    program.help(); // calls process.exit internally
    process.exit(0); // unreachable, but satisfies TypeScript
  }

  // TypeScript type assertion - result is definitely set at this point
  const parsedResult: CliResult = result as CliResult;

  // Detect interactive mode: just 'echelon' or 'echelon --yolo'
  if (parsedResult.command === 'run') {
    const runResult = parsedResult; // Store for type narrowing
    const opts = runResult.options;
    const isInteractive = (
      !opts.directive &&
      !opts.resume &&
      !opts.config &&
      !opts.headless &&
      !opts.dryRun &&
      !opts.telegram &&
      process.stdin.isTTY
    );

    if (isInteractive) {
      const interactiveResult: CliResult = { command: 'interactive', yolo: opts.yolo };
      return interactiveResult;
    }
  }

  return parsedResult;
}
