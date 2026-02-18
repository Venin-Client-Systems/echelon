import http from 'node:http';
import type { TelegramHealthConfig } from '../lib/types.js';
import { logger } from '../lib/logger.js';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  uptime: number;
  mode: 'telegram';
  lastActivity?: number;
  messageCount?: number;
  errorCount?: number;
}

export class HealthServer {
  private server: http.Server | null = null;
  private startTime: number;
  private stats: {
    lastActivity: number;
    messageCount: number;
    errorCount: number;
  };

  constructor(private config: TelegramHealthConfig) {
    this.startTime = Date.now();
    this.stats = {
      lastActivity: Date.now(),
      messageCount: 0,
      errorCount: 0,
    };
  }

  async start(): Promise<void> {
    if (this.server) {
      logger.warn('Health server already running');
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Only handle GET /health
        if (req.method === 'GET' && req.url === '/health') {
          const status = this.getStatus();
          const statusCode = status.status === 'healthy' ? 200 : 503;

          res.writeHead(statusCode, {
            'Content-Type': 'application/json',
          });
          res.end(JSON.stringify(status, null, 2));
        } else {
          // Return 404 for all other routes
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      });

      this.server.on('error', (err) => {
        logger.error('Health server error', {
          error: err instanceof Error ? err.message : String(err),
        });
        reject(err);
      });

      this.server.listen(this.config.port, this.config.bindAddress, () => {
        logger.info('Health server started', {
          port: this.config.port,
          bindAddress: this.config.bindAddress,
        });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger.warn('Health server shutdown timeout, forcing close');
        this.server?.close(() => {
          this.server = null;
          resolve();
        });
      }, 5000); // 5 second timeout

      this.server!.close((err) => {
        clearTimeout(timeout);
        if (err) {
          logger.error('Health server shutdown error', {
            error: err instanceof Error ? err.message : String(err),
          });
          reject(err);
        } else {
          logger.info('Health server stopped');
          this.server = null;
          resolve();
        }
      });
    });
  }

  recordActivity(): void {
    this.stats.lastActivity = Date.now();
    this.stats.messageCount++;
  }

  recordError(): void {
    this.stats.errorCount++;
  }

  private getStatus(): HealthStatus {
    const now = Date.now();
    const uptime = now - this.startTime;
    const timeSinceActivity = now - this.stats.lastActivity;
    const isHealthy = timeSinceActivity < 5 * 60 * 1000; // 5 minutes

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      uptime,
      mode: 'telegram',
      lastActivity: this.stats.lastActivity,
      messageCount: this.stats.messageCount,
      errorCount: this.stats.errorCount,
    };
  }
}
