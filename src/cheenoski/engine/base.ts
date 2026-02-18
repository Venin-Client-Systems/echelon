import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import type { EngineRunner, EngineRunOptions, EngineResult, EngineName } from '../types.js';
import { parseStreamJson, parseJsonOutput, isRateLimitError, errorResult } from './result-parser.js';

const SIGKILL_DELAY_MS = 5_000;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024; // 50 MB

export type ParserType = 'stream-json' | 'json';

export interface EngineSpec {
  /** Engine name */
  name: EngineName;
  /** Binary to spawn */
  binary: string;
  /** Build CLI args. Prompt file path is provided for file-based engines. */
  buildArgs: (opts: EngineRunOptions, promptFile: string) => string[];
  /** Extra environment variables */
  env?: (opts: EngineRunOptions) => Record<string, string | undefined>;
  /** Output parser type */
  parser: ParserType;
  /** If true, pipe prompt via stdin instead of writing to temp file */
  useStdin?: boolean;
}

/**
 * Base engine implementation shared by all engines.
 * Handles: spawn, buffer collection, timeout, SIGTERM→SIGKILL, parsing.
 * Writes prompt to a temp file to avoid OS argv limits (#18).
 */
export class BaseEngine implements EngineRunner {
  readonly name: EngineName;
  private proc: ReturnType<typeof spawn> | null = null;

  constructor(private spec: EngineSpec) {
    this.name = spec.name;
  }

  async run(opts: EngineRunOptions): Promise<EngineResult> {
    const start = Date.now();

    // Write prompt to temp file unless using stdin mode
    let promptFile = '';
    if (!this.spec.useStdin) {
      promptFile = join(tmpdir(), `cheenoski-prompt-${nanoid(8)}.md`);
      writeFileSync(promptFile, opts.prompt, 'utf-8');
    }

    const args = this.spec.buildArgs(opts, promptFile);

    const env: Record<string, string | undefined> = { ...process.env };
    if (this.spec.env) {
      Object.assign(env, this.spec.env(opts));
    }

    return new Promise<EngineResult>((resolve) => {
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let totalBytes = 0;
      let totalErrBytes = 0;
      let killed = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;

      this.proc = spawn(this.spec.binary, args, {
        cwd: opts.cwd,
        env: env as NodeJS.ProcessEnv,
        stdio: [this.spec.useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });

      // Attach error handler immediately to prevent unhandled rejections
      this.proc.on('error', (err) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (promptFile) this.cleanupPromptFile(promptFile);
        resolve(errorResult(this.spec.name, 'crash', err.message, Date.now() - start));
      });

      // Pipe prompt via stdin if configured
      if (this.spec.useStdin && this.proc.stdin) {
        this.proc.stdin.write(opts.prompt);
        this.proc.stdin.end();
      }

      this.proc.stdout!.on('data', (chunk: Buffer) => {
        if (totalBytes < MAX_OUTPUT_BYTES) {
          chunks.push(chunk);
          totalBytes += chunk.length;
        }
        // else: keep consuming to prevent backpressure, but don't buffer
      });
      this.proc.stderr!.on('data', (chunk: Buffer) => {
        if (totalErrBytes < MAX_OUTPUT_BYTES) {
          errChunks.push(chunk);
          totalErrBytes += chunk.length;
        }
      });

      const timer = setTimeout(() => {
        killed = true;
        this.proc?.kill('SIGTERM');
        killTimer = setTimeout(() => {
          try { this.proc?.kill('SIGKILL'); } catch { /* dead */ }
        }, SIGKILL_DELAY_MS);
        if (promptFile) this.cleanupPromptFile(promptFile);
        resolve(errorResult(this.spec.name, 'timeout', `Timed out after ${opts.timeoutMs}ms`, Date.now() - start));
      }, opts.timeoutMs);

      this.proc.on('close', (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (promptFile) this.cleanupPromptFile(promptFile);
        if (killed) return;

        const stdout = Buffer.concat(chunks).toString('utf-8');
        const stderr = Buffer.concat(errChunks).toString('utf-8');
        const durationMs = Date.now() - start;

        if (isRateLimitError(stderr, code)) {
          resolve(errorResult(this.spec.name, 'rate_limit', stderr || stdout, durationMs, code));
          return;
        }

        if (code !== 0) {
          resolve(errorResult(this.spec.name, 'crash', stderr || stdout, durationMs, code));
          return;
        }

        const parse = this.spec.parser === 'stream-json' ? parseStreamJson : parseJsonOutput;
        const { toolsUsed, filesChanged } = parse(stdout);

        resolve({
          success: true,
          output: stdout,
          toolsUsed,
          filesChanged,
          durationMs,
          engineName: this.spec.name,
          errorType: 'none',
          rawExitCode: code,
        });
      });
    });
  }

  kill(): void {
    if (this.proc) {
      const proc = this.proc;
      this.proc = null;
      proc.kill('SIGTERM');
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* dead */ }
      }, SIGKILL_DELAY_MS);
    }
  }

  private cleanupPromptFile(path: string): void {
    try { unlinkSync(path); } catch { /* best effort */ }
  }
}
