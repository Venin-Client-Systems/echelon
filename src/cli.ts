import { Command } from 'commander';
import type { CliOptions } from './lib/types.js';

export type CliResult =
  | { command: 'run'; options: CliOptions }
  | { command: 'init' }
  | { command: 'sessions'; action: 'list' | 'prune'; }
  | { command: 'sessions'; action: 'delete'; sessionId: string };

function addRunOptions(cmd: Command): Command {
  return cmd
    .option('-c, --config <path>', 'Path to echelon.config.json')
    .option('-d, --directive <text>', 'CEO directive to execute')
    .option('--headless', 'Run without TUI (headless mode)', false)
    .option('--dry-run', 'Show planned cascade without executing', false)
    .option('--resume', 'Resume the most recent session', false)
    .option('-v, --verbose', 'Enable debug logging', false)
    .option('--approval-mode <mode>', 'Override approval mode (destructive, all, none)')
    .option('--telegram', 'Start in Telegram bot mode', false);
}

function toRunResult(cmd: Command): CliResult {
  const opts = cmd.opts();
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
    },
  };
}

export function parseArgs(argv: string[]): CliResult {
  let result: CliResult | null = null;

  const program = new Command();

  program
    .name('echelon')
    .description('Hierarchical multi-agent AI org orchestrator')
    .version('0.1.0');

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

  return result;
}
