import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../lib/logger.js';
import type { ClaudeJsonOutput } from '../lib/types.js';
import { DEFAULT_MAX_TURNS } from '../lib/types.js';
import { withErrorBoundary, CircuitBreaker } from './error-boundaries.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min — management agents may think long
const SIGKILL_DELAY_MS = 5_000; // 5s grace after SIGTERM before SIGKILL

// Resolve claude binary path once at startup
let claudeBin: string | null = null;

// Global circuit breaker for agent spawn/resume operations
// Shared across all agents to prevent cascading failures
const agentCircuitBreaker = new CircuitBreaker(5, 60000);

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
  maxTurns?: number;
  timeoutMs?: number;
  cwd?: string;
  yolo?: boolean;
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

    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      // Follow up with SIGKILL if SIGTERM doesn't work
      killTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, SIGKILL_DELAY_MS);
      reject(new Error(`Claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
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
      // Handle error_max_turns or other cases where result is missing
      if (parsed.type === 'result' && parsed.session_id) {
        return {
          result: parsed.result ?? `[Agent stopped: ${parsed.subtype ?? 'unknown'}]`,
          session_id: parsed.session_id,
          total_cost_usd: parsed.total_cost_usd,
          duration_ms: parsed.duration_ms,
          is_error: parsed.is_error ?? true,
        };
      }
    } catch { /* not JSON, keep looking */ }
  }
  // Last resort: try parsing the whole thing
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.result === 'string') return parsed;
    if (parsed.type === 'result' && parsed.session_id) {
      return {
        result: parsed.result ?? `[Agent stopped: ${parsed.subtype ?? 'unknown'}]`,
        session_id: parsed.session_id,
        total_cost_usd: parsed.total_cost_usd,
        duration_ms: parsed.duration_ms,
        is_error: parsed.is_error ?? true,
      };
    }
  } catch { /* not JSON */ }

  const preview = stdout.slice(0, 300).replace(/\n/g, '\\n');
  throw new Error(`Failed to parse Claude JSON output (expected {result: string}). Got: ${preview}`);
}

/** Spawn a new Claude session */
export async function spawnAgent(
  prompt: string,
  opts: SpawnOptions,
): Promise<AgentResponse> {
  return withErrorBoundary(
    async () => {
      const start = Date.now();
      const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS[opts.model] ?? 8;
      const args = [
        '-p', prompt,
        '--output-format', 'json',
        '--model', opts.model,
        '--max-turns', String(maxTurns),
        '--append-system-prompt', opts.systemPrompt,
      ];

      if (opts.maxBudgetUsd > 0) {
        args.push('--max-budget-usd', opts.maxBudgetUsd.toString());
      }

      if (opts.yolo) {
        args.push('--dangerously-skip-permissions');
      }

      logger.debug('Spawning agent', { model: opts.model, maxTurns });
      const stdout = await runClaude(args, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.cwd);
      const output = parseOutput(stdout);

      if (output.is_error === true) {
        throw new Error(`Claude agent error: ${output.result}`);
      }

      return {
        content: output.result,
        sessionId: output.session_id,
        costUsd: output.total_cost_usd ?? 0,
        durationMs: Date.now() - start,
      };
    },
    `spawnAgent(${opts.model})`,
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 32000,
    },
    agentCircuitBreaker,
  );
}

/** Resume an existing Claude session */
export async function resumeAgent(
  sessionId: string,
  prompt: string,
  opts: { maxTurns?: number; timeoutMs?: number; cwd?: string; maxBudgetUsd?: number; yolo?: boolean },
): Promise<AgentResponse> {
  return withErrorBoundary(
    async () => {
      const start = Date.now();
      const maxTurns = opts.maxTurns ?? 8;
      const args = [
        '-r', sessionId,
        '-p', prompt,
        '--output-format', 'json',
        '--max-turns', String(maxTurns),
      ];

      if (opts.maxBudgetUsd != null && opts.maxBudgetUsd > 0) {
        args.push('--max-budget-usd', String(opts.maxBudgetUsd));
      }

      if (opts.yolo) {
        args.push('--dangerously-skip-permissions');
      }

      logger.debug('Resuming agent', { sessionId: sessionId.slice(0, 8), maxTurns });
      const stdout = await runClaude(args, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.cwd);
      const output = parseOutput(stdout);

      if (output.is_error === true) {
        throw new Error(`Claude agent error: ${output.result}`);
      }

      return {
        content: output.result,
        sessionId: output.session_id,
        costUsd: output.total_cost_usd ?? 0,
        durationMs: Date.now() - start,
      };
    },
    `resumeAgent(${sessionId.slice(0, 8)})`,
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 32000,
    },
    agentCircuitBreaker,
  );
}
