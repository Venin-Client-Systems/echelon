import type { EngineRunner, EngineName, EngineResult, EngineRunOptions } from '../types.js';
import { logger } from '../../lib/logger.js';
import { createEngine } from './index.js';

/** Rate limit backoff tracking per engine */
const rateLimitBackoffs = new Map<EngineName, { until: number; attempts: number }>();

const BASE_BACKOFF_MS = 30_000; // 30s
const MAX_BACKOFF_MS = 300_000; // 5min

/** Check if an engine is currently rate-limited */
export function isRateLimited(engine: EngineName): boolean {
  const backoff = rateLimitBackoffs.get(engine);
  if (!backoff) return false;
  if (Date.now() >= backoff.until) {
    rateLimitBackoffs.delete(engine);
    return false;
  }
  return true;
}

/** Record a rate limit for an engine */
export function recordRateLimit(engine: EngineName): void {
  const existing = rateLimitBackoffs.get(engine);
  const attempts = (existing?.attempts ?? 0) + 1;
  const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts - 1), MAX_BACKOFF_MS);
  rateLimitBackoffs.set(engine, {
    until: Date.now() + delay,
    attempts,
  });
  logger.warn(`Rate limit recorded for ${engine}`, {
    backoffMs: delay,
    attempts,
  });
}

/** Clear rate limit tracking (e.g., on successful run) */
export function clearRateLimit(engine: EngineName): void {
  rateLimitBackoffs.delete(engine);
}

/** Reset all rate limit tracking (for testing or fresh starts) */
export function resetAllRateLimits(): void {
  rateLimitBackoffs.clear();
}

/**
 * Run an engine with fallback chain support.
 * If the primary engine is rate-limited or fails with a rate limit,
 * automatically switches to the next engine in the chain.
 */
export async function runWithFallback(
  opts: EngineRunOptions,
  primaryEngine: EngineName,
  fallbackChain: EngineName[],
  onSwitch?: (from: EngineName, to: EngineName, reason: string) => void,
  onEngineCreated?: (engine: EngineRunner) => void,
): Promise<EngineResult> {
  const chain = [primaryEngine, ...fallbackChain];

  for (let i = 0; i < chain.length; i++) {
    const engineName = chain[i];

    // Skip rate-limited engines
    if (isRateLimited(engineName)) {
      const backoff = rateLimitBackoffs.get(engineName);
      const remainingMs = backoff ? backoff.until - Date.now() : 0;
      logger.info(`Skipping ${engineName} (rate-limited for ${(remainingMs / 1000).toFixed(0)}s)`);

      if (i > 0 || chain.length > 1) {
        const next = chain[i + 1];
        if (next) {
          onSwitch?.(engineName, next, `rate-limited (${(remainingMs / 1000).toFixed(0)}s remaining)`);
        }
      }
      continue;
    }

    let engine: EngineRunner;
    try {
      engine = createEngine(engineName);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to create ${engineName} engine: ${errMsg}`);

      // Try next engine in chain
      const next = chain[i + 1];
      if (next) {
        onSwitch?.(engineName, next, `engine creation failed: ${errMsg}`);
        continue;
      }

      // No more fallbacks
      return {
        success: false,
        output: `Failed to create ${engineName}: ${errMsg}`,
        toolsUsed: [],
        filesChanged: [],
        durationMs: 0,
        engineName,
        errorType: 'crash',
        rawExitCode: null,
      };
    }

    onEngineCreated?.(engine);

    // Wrap engine.run() in try/catch to handle unexpected exceptions
    // Engines should return result objects, but if they throw, treat as crash
    let result: EngineResult;
    try {
      result = await engine.run(opts);
    } catch (runErr) {
      const errMsg = runErr instanceof Error ? runErr.message : String(runErr);
      logger.error(`${engineName} engine threw exception (treating as crash): ${errMsg}`);

      // Convert exception to result object
      result = {
        success: false,
        output: `Engine threw exception: ${errMsg}`,
        toolsUsed: [],
        filesChanged: [],
        durationMs: 0,
        engineName,
        errorType: 'crash',
        rawExitCode: null,
      };
    }

    if (result.errorType === 'rate_limit') {
      recordRateLimit(engineName);

      // Try next engine in chain
      const next = chain[i + 1];
      if (next) {
        onSwitch?.(engineName, next, 'rate limit hit');
        continue;
      }

      // No more fallbacks
      return result;
    }

    // Successful run or non-rate-limit failure — clear backoff and return
    if (result.success) {
      clearRateLimit(engineName);
    }

    return result;
  }

  // All engines exhausted (all rate-limited)
  return {
    success: false,
    output: 'All engines rate-limited or unavailable',
    toolsUsed: [],
    filesChanged: [],
    durationMs: 0,
    engineName: primaryEngine,
    errorType: 'rate_limit',
    rawExitCode: null,
  };
}
