import { logger } from '../lib/logger.js';
import type { EchelonConfig, EchelonState, LayerId } from '../lib/types.js';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 2_000,
  maxDelayMs: 30_000,
};

/** Exponential backoff with jitter */
function backoffDelay(attempt: number, opts: RetryOptions): number {
  const delay = Math.min(
    opts.baseDelayMs * Math.pow(2, attempt),
    opts.maxDelayMs,
  );
  // Add 0-25% jitter
  return delay + Math.random() * delay * 0.25;
}

/** Sleep for a given number of ms */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Retry an async function with exponential backoff */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: Partial<RetryOptions> = {},
): Promise<T> {
  const config = { ...DEFAULT_RETRY, ...opts };

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (attempt === config.maxRetries) {
        logger.error(`${label}: all ${config.maxRetries} retries exhausted`, { error: msg });
        throw err;
      }

      const delay = backoffDelay(attempt, config);
      logger.warn(`${label}: attempt ${attempt + 1} failed, retrying in ${(delay / 1000).toFixed(1)}s`, {
        error: msg,
        attempt: attempt + 1,
        maxRetries: config.maxRetries,
      });
      await sleep(delay);
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error(`${label}: retry logic error`);
}

/** Check if a layer is within its budget */
export function checkLayerBudget(
  state: EchelonState,
  config: EchelonConfig,
  layer: LayerId,
): { ok: boolean; remaining: number; spent: number; limit: number } {
  const spent = state.agents[layer].totalCost;
  const limit = config.layers[layer].maxBudgetUsd;
  return {
    ok: spent < limit,
    remaining: Math.max(0, limit - spent),
    spent,
    limit,
  };
}

/** Check total budget across all layers */
export function checkTotalBudget(
  state: EchelonState,
  config: EchelonConfig,
): { ok: boolean; remaining: number; spent: number; limit: number } {
  return {
    ok: state.totalCost < config.maxTotalBudgetUsd,
    remaining: Math.max(0, config.maxTotalBudgetUsd - state.totalCost),
    spent: state.totalCost,
    limit: config.maxTotalBudgetUsd,
  };
}

/** Get a budget summary string */
export function budgetSummary(state: EchelonState, config: EchelonConfig): string {
  const total = checkTotalBudget(state, config);
  const layers = (['2ic', 'eng-lead', 'team-lead'] as const).map(l => {
    const b = checkLayerBudget(state, config, l);
    return `${l}: $${b.spent.toFixed(2)}/$${b.limit.toFixed(2)}`;
  });
  return `Total: $${total.spent.toFixed(2)}/$${total.limit.toFixed(2)} | ${layers.join(' | ')}`;
}
