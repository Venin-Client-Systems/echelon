import { nanoid } from 'nanoid';
import { logger } from '../lib/logger.js';
import type { Orchestrator } from '../core/orchestrator.js';
import { DashboardServer } from './server.js';

/**
 * Dashboard process metadata.
 *
 * Stores the server instance, authentication token, and URL for dashboard access.
 *
 * @category Dashboard
 */
export interface DashboardProcess {
  server: DashboardServer;
  url: string;
  token: string;
  port: number;
}

/**
 * Start the dashboard server and attach it to the orchestrator.
 *
 * Creates a new DashboardServer instance, generates a random auth token,
 * and starts listening on the specified port. If the port is in use,
 * retries with the next port (up to 5 attempts).
 *
 * @param orchestrator - Running Orchestrator instance to serve state from
 * @param port - Port to listen on (default: 3030)
 * @returns Promise resolving to dashboard process metadata
 * @throws {Error} If all port attempts fail
 *
 * @category Dashboard
 *
 * @example
 * ```typescript
 * import { Orchestrator } from '../core/orchestrator.js';
 * import { startDashboardServer } from './lifecycle.js';
 *
 * const orchestrator = new Orchestrator({ ... });
 * const dashboard = await startDashboardServer(orchestrator, 3030);
 *
 * console.log(`Dashboard: ${dashboard.url}`);
 * ```
 */
export async function startDashboardServer(
  orchestrator: Orchestrator,
  port: number,
): Promise<DashboardProcess> {
  const token = nanoid(32);
  const MAX_RETRIES = 5;
  let lastError: Error | null = null;

  // Try up to 5 ports (starting from the requested port)
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const attemptPort = port + attempt;

    try {
      const server = new DashboardServer(orchestrator, token);
      await server.start(attemptPort);

      const url = `http://localhost:${attemptPort}?token=${token}`;

      logger.info(`Dashboard server started`, {
        url,
        port: attemptPort,
        token: token.slice(0, 8) + '...',
      });

      // Print to console so it's visible in headless mode
      console.log(`\n  Dashboard: ${url}\n`);

      return {
        server,
        url,
        token,
        port: attemptPort,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check if this is a port-in-use error
      const isPortInUse =
        (err instanceof Error && err.message.includes('EADDRINUSE')) ||
        (err instanceof Error && err.message.includes('address already in use'));

      if (isPortInUse && attempt < MAX_RETRIES - 1) {
        logger.debug(`Port ${attemptPort} in use, retrying with ${attemptPort + 1}`, {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
        });
        continue;
      }

      // Non-port error or last attempt — fail
      break;
    }
  }

  // All attempts failed
  const errorMsg = lastError?.message ?? 'Unknown error';
  logger.error(`Failed to start dashboard server after ${MAX_RETRIES} attempts`, {
    error: errorMsg,
    portRange: `${port}-${port + MAX_RETRIES - 1}`,
  });
  throw new Error(`Failed to start dashboard server: ${errorMsg}`);
}

/**
 * Stop the dashboard server gracefully.
 *
 * Closes all WebSocket connections, stops the HTTP server, and cleans up resources.
 *
 * @param dashboard - Dashboard process metadata from startDashboardServer
 *
 * @category Dashboard
 *
 * @example
 * ```typescript
 * const dashboard = await startDashboardServer(orchestrator, 3030);
 *
 * // Later...
 * await stopDashboardServer(dashboard);
 * ```
 */
export async function stopDashboardServer(dashboard: DashboardProcess): Promise<void> {
  logger.info('Stopping dashboard server', { port: dashboard.port });

  try {
    await dashboard.server.stop();
    logger.info('Dashboard server stopped');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to stop dashboard server gracefully', { error: errorMsg });
    // Don't throw — we're shutting down anyway
  }
}
