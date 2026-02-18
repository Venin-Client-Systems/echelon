import { Command } from 'commander';
import type { CliOptions } from './lib/types.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export type CliResult =
  | { command: 'run'; options: CliOptions }
  | { command: 'init' }
  | { command: 'sessions'; action: 'list' | 'prune'; }
  | { command: 'sessions'; action: 'delete'; sessionId: string };

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
    .version(packageJson.version);

  // Default run command (when no subcommand given)
  program
    .option('-c, --config <path>', 'Path to echelon.config.json')
    .option('-d, --directive <text>', 'CEO directive to execute')
    .option('--headless', 'Run without TUI (headless mode)', false)
    .option('--dry-run', 'Show planned cascade without executing', false)
    .option('--resume', 'Resume the most recent session', false)
    .option('-v, --verbose', 'Enable debug logging', false)
    .option('--approval-mode <mode>', 'Override approval mode (destructive, all, none)')
    .action((opts) => {
      result = {
        command: 'run',
        options: {
          config: opts.config,
          directive: opts.directive,
          headless: opts.headless,
          dryRun: opts.dryRun,
          resume: opts.resume,
          verbose: opts.verbose,
          approvalMode: opts.approvalMode,
        },
      };
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
