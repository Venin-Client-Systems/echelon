import type { MessageBus } from '../core/message-bus.js';
import type { EchelonConfig, EchelonState } from '../lib/types.js';
import { CheenoskiRunner } from '../cheenoski/index.js';
import { logger } from '../lib/logger.js';

/** Active Cheenoski runners and their run promises (keyed by label) */
const activeRunners = new Map<string, { runner: CheenoskiRunner; runPromise: Promise<void> }>();

/**
 * Invoke Cheenoski for a label.
 * Non-blocking: starts the runner and returns a kill handle + completion callback.
 */
export function invokeCheenoski(
  label: string,
  config: EchelonConfig,
  maxParallel: number | undefined,
  bus: MessageBus,
  onProgress?: (line: string) => void,
): { kill: () => void; onComplete: (callback: () => void) => void } {
  // If a runner already exists for this label, prevent concurrent invocation
  const existing = activeRunners.get(label);
  if (existing) {
    logger.warn(`Runner already active for label "${label}" — ignoring duplicate invocation. Kill the existing runner first if needed.`);
    return {
      kill: () => {
        existing.runner.kill();
        logger.info(`Killed existing runner for ${label}`);
      },
      onComplete: (callback: () => void) => {
        existing.runPromise.finally(callback);
      },
    };
  }

  const runner = new CheenoskiRunner(config, bus);

  // Run asynchronously — don't await in the action executor
  // Track the run promise so we can prevent concurrent invocations
  const runPromise = runner.run(label, maxParallel)
    .then((state) => {
      onProgress?.(`[DONE] Cheenoski ${label}: ${state.completedCount}/${state.totalIssues} succeeded`);
      logger.info(`Cheenoski completed for ${label}`, {
        total: state.totalIssues,
        succeeded: state.completedCount,
        failed: state.failedCount,
      });
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      onProgress?.(`[ERROR] Cheenoski ${label}: ${msg}`);
      logger.error(`Cheenoski failed for ${label}`, { error: msg });
    })
    .finally(() => {
      // Clean up when run completes (success or failure)
      const current = activeRunners.get(label);
      if (current?.runner === runner) {
        activeRunners.delete(label);
      }
    });

  activeRunners.set(label, { runner, runPromise });

  return {
    kill: () => {
      runner.kill();
      const current = activeRunners.get(label);
      if (current?.runner === runner) {
        activeRunners.delete(label);
      }
      logger.info(`Killed Cheenoski runner for ${label}`);
    },
    onComplete: (callback: () => void) => {
      runPromise.finally(callback);
    },
  };
}

/** Kill all active Cheenoski runners */
export function killAllCheenoski(): void {
  for (const [label, { runner }] of activeRunners) {
    runner.kill();
    logger.info(`Killed Cheenoski runner: ${label}`);
  }
  activeRunners.clear();
}
