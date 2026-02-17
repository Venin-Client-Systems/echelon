import type { MessageBus } from '../core/message-bus.js';
import type { EchelonConfig, EchelonState } from '../lib/types.js';
import { CheenoskiRunner } from '../cheenoski/index.js';
import { logger } from '../lib/logger.js';

/** Active Cheenoski runners (keyed by label) for kill support */
const activeRunners = new Map<string, CheenoskiRunner>();

/**
 * Invoke Cheenoski for a label. Replaces invokeRalphy.
 * Non-blocking: starts the runner and returns a kill handle.
 */
export function invokeCheenoski(
  label: string,
  config: EchelonConfig,
  maxParallel: number | undefined,
  bus: MessageBus,
  onProgress?: (line: string) => void,
): { kill: () => void } {
  const runner = new CheenoskiRunner(config, bus);
  activeRunners.set(label, runner);

  // Run asynchronously — don't await in the action executor
  runner.run(label, maxParallel)
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
      activeRunners.delete(label);
    });

  return {
    kill: () => {
      runner.kill();
      activeRunners.delete(label);
      logger.info(`Killed Cheenoski runner for ${label}`);
    },
  };
}

/** Kill all active Cheenoski runners */
export function killAllCheenoski(): void {
  for (const [label, runner] of activeRunners) {
    runner.kill();
    logger.info(`Killed Cheenoski runner: ${label}`);
  }
  activeRunners.clear();
}
