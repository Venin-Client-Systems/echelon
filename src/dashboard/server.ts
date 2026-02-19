import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Orchestrator } from '../core/orchestrator.js';
import { createApiRouter } from './api.js';
import { logger } from '../lib/logger.js';
import type { EchelonEvent } from '../lib/types.js';
import { nanoid } from 'nanoid';

/**
 * Dashboard server for Echelon orchestrator.
 *
 * Provides REST API endpoints for initial state hydration and WebSocket streaming
 * for real-time updates. Runs on a configurable port (default: 3456) and serves:
 * - GET /api/state — Current orchestrator status
 * - GET /api/sessions — List of all sessions
 * - GET /api/sessions/:id/state — Load specific session
 * - GET /api/sessions/:id/transcript — Fetch transcript markdown
 * - WebSocket /ws?token=<auth-token> — Real-time event stream
 *
 * @category Dashboard
 *
 * @example
 * ```typescript
 * import { DashboardServer } from './dashboard/server.js';
 *
 * const server = new DashboardServer(orchestrator, 'my-secret-token');
 * await server.start(3456);
 *
 * // Later...
 * await server.stop();
 * ```
 */
export class DashboardServer {
  private app: express.Application;
  private server: ReturnType<typeof express.application.listen> | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private eventHandler: ((event: EchelonEvent) => void) | null = null;
  private readonly orchestrator: Orchestrator;
  private readonly authToken: string;

  /**
   * Create a new dashboard server instance.
   *
   * @param orchestrator - Running Orchestrator instance to serve state from
   * @param authToken - Optional authentication token for WebSocket connections (auto-generated if not provided)
   */
  constructor(orchestrator: Orchestrator, authToken?: string) {
    this.orchestrator = orchestrator;
    this.authToken = authToken ?? nanoid(32);
    this.app = express();

    // JSON body parser for future POST endpoints
    this.app.use(express.json());

    // Mount API router
    const apiRouter = createApiRouter(orchestrator);
    this.app.use('/api', apiRouter);

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        sessionId: orchestrator.state.sessionId,
        connections: this.clients.size,
      });
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
   * Start the dashboard server with WebSocket support.
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
            authToken: this.authToken,
          });
          resolve();
        });

        this.server.on('error', (err) => {
          logger.error('Dashboard server failed to start', { error: err.message, port });
          reject(err);
        });

        // Set up WebSocket server with manual upgrade handling for auth
        this.wss = new WebSocketServer({ noServer: true });

        // Handle WebSocket upgrade with token authentication
        this.server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
          const url = new URL(request.url ?? '', `http://${request.headers.host}`);
          const token = url.searchParams.get('token');

          // Validate authentication token
          if (token !== this.authToken) {
            logger.warn('WebSocket connection rejected: invalid token', {
              ip: request.socket.remoteAddress,
            });
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          // Upgrade the connection
          this.wss!.handleUpgrade(request, socket, head, (ws) => {
            this.wss!.emit('connection', ws, request);
          });
        });

        // Handle WebSocket connections
        this.wss.on('connection', (ws: WebSocket) => {
          logger.debug('WebSocket client connected', { totalClients: this.clients.size + 1 });
          this.clients.add(ws);

          ws.on('close', () => {
            logger.debug('WebSocket client disconnected', { totalClients: this.clients.size - 1 });
            this.clients.delete(ws);
          });

          ws.on('error', (err) => {
            logger.error('WebSocket client error', { error: err.message });
            this.clients.delete(ws);
          });
        });

        // Subscribe to MessageBus and broadcast events to all connected clients
        this.eventHandler = (event: EchelonEvent) => {
          const msg = JSON.stringify(event);
          for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(msg);
              } catch (err) {
                logger.error('Failed to send WebSocket message', {
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
        };
        this.orchestrator.bus.onEchelon(this.eventHandler);

        logger.info('WebSocket server initialized', {
          authToken: this.authToken.slice(0, 8) + '...',
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Get the authentication token for WebSocket connections.
   *
   * @returns The auth token string
   */
  getAuthToken(): string {
    return this.authToken;
  }

  /**
   * Stop the dashboard server with graceful WebSocket cleanup.
   *
   * Unsubscribes from MessageBus, closes all WebSocket connections,
   * and shuts down the HTTP server.
   *
   * @returns Promise that resolves when server is closed
   */
  async stop(): Promise<void> {
    // Unsubscribe from MessageBus to prevent memory leak
    if (this.eventHandler) {
      this.orchestrator.bus.offEchelon(this.eventHandler);
      this.eventHandler = null;
      logger.debug('Unsubscribed from MessageBus');
    }

    // Close all WebSocket connections
    for (const client of this.clients) {
      try {
        client.close(1000, 'Server shutting down');
      } catch (err) {
        logger.error('Error closing WebSocket client', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
      logger.debug('WebSocket server closed');
    }

    // Close HTTP server
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
