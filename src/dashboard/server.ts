import express from 'express';
import type { Orchestrator } from '../core/orchestrator.js';
import { createApiRouter } from './api.js';
import { logger } from '../lib/logger.js';

/**
 * Dashboard server for Echelon orchestrator.
 *
 * Provides REST API endpoints for initial state hydration and real-time updates.
 * Runs on a configurable port (default: 3456) and serves:
 * - GET /api/state — Current orchestrator status
 * - GET /api/sessions — List of all sessions
 * - GET /api/sessions/:id/state — Load specific session
 * - GET /api/sessions/:id/transcript — Fetch transcript markdown
 *
 * @category Dashboard
 *
 * @example
 * ```typescript
 * import { DashboardServer } from './dashboard/server.js';
 *
 * const server = new DashboardServer(orchestrator);
 * await server.start(3456);
 *
 * // Later...
 * await server.stop();
 * ```
 */
export class DashboardServer {
  private app: express.Application;
  private server: ReturnType<typeof express.application.listen> | null = null;
  private readonly orchestrator: Orchestrator;

  /**
   * Create a new dashboard server instance.
   *
   * @param orchestrator - Running Orchestrator instance to serve state from
   */
  constructor(orchestrator: Orchestrator) {
    this.orchestrator = orchestrator;
    this.app = express();

    // JSON body parser for future POST endpoints
    this.app.use(express.json());

    // Mount API router
    const apiRouter = createApiRouter(orchestrator);
    this.app.use('/api', apiRouter);

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', sessionId: orchestrator.state.sessionId });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    this.app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Dashboard server error', { error: err.message, path: req.path });
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  /**
   * Start the dashboard server.
   *
   * @param port - Port to listen on (default: 3456)
   * @returns Promise that resolves when server is listening
   */
  async start(port = 3456): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, () => {
          logger.info(`Dashboard server listening on port ${port}`, {
            sessionId: this.orchestrator.state.sessionId,
          });
          resolve();
        });

        this.server.on('error', (err) => {
          logger.error('Dashboard server failed to start', { error: err.message, port });
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop the dashboard server.
   *
   * @returns Promise that resolves when server is closed
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          logger.error('Failed to stop dashboard server', { error: err.message });
          reject(err);
        } else {
          logger.info('Dashboard server stopped');
          this.server = null;
          resolve();
        }
      });
    });
  }
}
