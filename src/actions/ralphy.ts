import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { logger } from '../lib/logger.js';
import type { EchelonConfig } from '../lib/types.js';

// Strip ANSI escape codes
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Find the bundled Ralphy directory.
 * Looks relative to the echelon package root.
 */
function findRalphyDir(): string {
  // __dirname equivalent for ESM
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // Go up from src/actions/ to echelon root
  const candidates = [
    join(thisDir, '..', '..', 'ralphy'),       // from src/actions/
    join(thisDir, '..', '..', '..', 'ralphy'),  // from dist/actions/
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'ralphy.sh'))) return candidate;
  }

  throw new Error('Bundled Ralphy not found. Expected at echelon/ralphy/ralphy.sh');
}

/**
 * Invoke bundled Ralphy as a subprocess.
 * Captures stdout and parses progress events.
 */
export function invokeRalphy(
  label: string,
  config: EchelonConfig,
  maxParallel?: number,
  onProgress?: (line: string) => void,
): { kill: () => void } {
  const ralphyDir = findRalphyDir();
  const ralphyScript = join(ralphyDir, 'ralphy.sh');

  const args = [
    ralphyScript,
    '--github', config.project.repo,
    '--github-label', label,
    '--parallel',
    '--max-parallel', String(maxParallel ?? config.engineers.maxParallel),
  ];

  if (config.engineers.createPr) args.push('--create-pr');
  if (config.engineers.prDraft) args.push('--pr-draft');

  logger.info('Invoking Ralphy', { label, maxParallel: maxParallel ?? config.engineers.maxParallel });

  const proc = spawn('bash', args, {
    cwd: config.project.path,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buffer = '';

  const processLine = (line: string) => {
    const clean = stripAnsi(line).trim();
    if (!clean) return;

    // Detect known Ralphy output patterns
    if (clean.includes('Processing issue') || clean.includes('Starting task') ||
        clean.includes('Completed') || clean.includes('Failed') ||
        clean.includes('PR created') || clean.includes('All tasks')) {
      logger.info(`[Ralphy:${label}] ${clean}`);
    }

    onProgress?.(clean);
  };

  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) processLine(line);
  });

  proc.stderr.on('data', (chunk: Buffer) => {
    const text = stripAnsi(chunk.toString('utf-8')).trim();
    if (text) logger.debug(`[Ralphy:${label}:stderr] ${text}`);
  });

  proc.on('close', (code) => {
    if (buffer) processLine(buffer);
    if (code === 0) {
      logger.info(`Ralphy completed for ${label}`);
      onProgress?.(`[DONE] Ralphy ${label} completed successfully`);
    } else {
      logger.error(`Ralphy failed for ${label}`, { exitCode: code ?? -1 });
      onProgress?.(`[ERROR] Ralphy ${label} exited with code ${code}`);
    }
  });

  proc.on('error', (err) => {
    logger.error(`Failed to spawn Ralphy`, { error: err.message });
    onProgress?.(`[ERROR] Failed to spawn Ralphy: ${err.message}`);
  });

  return {
    kill: () => {
      proc.kill('SIGTERM');
      logger.info(`Killed Ralphy process for ${label}`);
    },
  };
}
