import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../lib/logger.js';
import type { ClaudeJsonOutput } from '../lib/types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min — management agents may think long
const SIGKILL_DELAY_MS = 5_000; // 5s grace after SIGTERM before SIGKILL

// Resolve claude binary path once at startup
let claudeBin: string | null = null;

async function getClaudeBin(): Promise<string> {
  if (claudeBin) return claudeBin;
  try {
    const { stdout } = await execFileAsync('which', ['claude'], { encoding: 'utf-8' });
    claudeBin = stdout.trim();
    return claudeBin;
  } catch {
    throw new Error('claude CLI not found. Install from https://claude.ai/cli');
  }
}

export interface SpawnOptions {
  model: string;
  maxBudgetUsd: number;
  systemPrompt: string;
  timeoutMs?: number;
  cwd?: string;
}

export interface AgentResponse {
  content: string;
  sessionId: string;
  costUsd: number;
  durationMs: number;
}

async function runClaude(args: string[], timeoutMs: number, cwd?: string): Promise<string> {
  const bin = await getClaudeBin();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let killed = false;

    // Unset CLAUDECODE to prevent nested Claude Code sessions from interfering
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = spawn(bin, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    });

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      // Follow up with SIGKILL if SIGTERM doesn't work
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, SIGKILL_DELAY_MS);
      reject(new Error(`Claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return; // already rejected by timeout
      const stdout = Buffer.concat(chunks).toString('utf-8');
      const stderr = Buffer.concat(errChunks).toString('utf-8');

      if (code !== 0) {
        logger.error('Claude process failed', { code: code ?? -1, stderr: stderr.slice(0, 500) });
        reject(new Error(`Claude exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

function parseOutput(stdout: string): ClaudeJsonOutput {
  const lines = stdout.trim().split('\n');
  // Search from the end for the JSON envelope with --output-format json
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (typeof parsed.result === 'string') return parsed;
    } catch { /* not JSON, keep looking */ }
  }
  // Last resort: try parsing the whole thing
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.result === 'string') return parsed;
  } catch { /* not JSON */ }

  const preview = stdout.slice(0, 300).replace(/\n/g, '\\n');
  throw new Error(`Failed to parse Claude JSON output (expected {result: string}). Got: ${preview}`);
}

/** Spawn a new Claude session */
export async function spawnAgent(
  prompt: string,
  opts: SpawnOptions,
): Promise<AgentResponse> {
  const start = Date.now();
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--model', opts.model,
    '--max-turns', '1',
    '--append-system-prompt', opts.systemPrompt,
  ];

  if (opts.maxBudgetUsd > 0) {
    args.push('--max-budget-usd', opts.maxBudgetUsd.toString());
  }

  logger.debug('Spawning agent', { model: opts.model });
  const stdout = await runClaude(args, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.cwd);
  const output = parseOutput(stdout);

  return {
    content: output.result,
    sessionId: output.session_id,
    costUsd: output.total_cost_usd ?? 0,
    durationMs: Date.now() - start,
  };
}

/** Resume an existing Claude session */
export async function resumeAgent(
  sessionId: string,
  prompt: string,
  opts: { timeoutMs?: number; cwd?: string },
): Promise<AgentResponse> {
  const start = Date.now();
  const args = [
    '-r', sessionId,
    '-p', prompt,
    '--output-format', 'json',
    '--max-turns', '1',
  ];

  logger.debug('Resuming agent', { sessionId: sessionId.slice(0, 8) });
  const stdout = await runClaude(args, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.cwd);
  const output = parseOutput(stdout);

  return {
    content: output.result,
    sessionId: output.session_id,
    costUsd: output.total_cost_usd ?? 0,
    durationMs: Date.now() - start,
  };
}
