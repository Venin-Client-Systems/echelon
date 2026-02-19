import { Router } from 'express';
import cors from 'cors';
import { loadState } from '../core/state.js';
import { sessionDir, SESSIONS_DIR } from '../lib/paths.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Orchestrator } from '../core/orchestrator.js';
import { logger } from '../lib/logger.js';

/**
 * Create REST API router for dashboard initial state hydration.
 *
 * Provides endpoints to fetch current orchestrator state, session history,
 * and metrics before WebSocket streaming begins.
 *
 * @param orchestrator - Running Orchestrator instance
 * @returns Express router with API routes
 *
 * @category Dashboard
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createApiRouter } from './dashboard/api.js';
 *
 * const app = express();
 * const router = createApiRouter(orchestrator);
 * app.use('/api', router);
 * app.listen(3000);
 * ```
 */
export function createApiRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  // Enable CORS for browser access
  router.use(cors());

  /**
   * GET /api/state
   *
   * Returns current orchestrator status + full state snapshot.
   * Combines getStatus() metrics with detailed state (messages, plan, issues).
   *
   * Response:
   * - sessionId, projectRepo, status, cascadePhase
   * - agents (with costs, turns, status)
   * - messages, plan, issues
   * - totalCost, maxTotalBudget
   * - startedAt, updatedAt
   * - issueCount, messageCount, pendingApprovals
   */
  router.get('/state', (req, res) => {
    try {
      const status = orchestrator.getStatus();
      const state = orchestrator.state;

      res.json({
        ...status,
        messages: state.messages,
        plan: state.plan,
        issues: state.issues,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to get orchestrator state', { error: errMsg });
      res.status(500).json({ error: 'Failed to retrieve state' });
    }
  });

  /**
   * GET /api/sessions
   *
   * Returns list of all available sessions from ~/.echelon/sessions/.
   * Each session includes metadata (ID, repo, status, costs, timestamps).
   *
   * Response: Array of session summaries
   */
  router.get('/sessions', (req, res) => {
    try {
      if (!existsSync(SESSIONS_DIR)) {
        return res.json([]);
      }

      const sessions = readdirSync(SESSIONS_DIR)
        .map((id) => {
          const state = loadState(id);
          return state
            ? {
                id: state.sessionId,
                repo: state.projectRepo,
                status: state.status,
                startedAt: state.startedAt,
                updatedAt: state.updatedAt,
                totalCost: state.totalCost,
                directive: state.directive,
                cascadePhase: state.cascadePhase,
              }
            : null;
        })
        .filter(Boolean);

      res.json(sessions);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to list sessions', { error: errMsg });
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  /**
   * GET /api/sessions/:id/state
   *
   * Load specific session state by ID.
   * Returns full EchelonState JSON or 404 if session doesn't exist.
   *
   * Path params:
   * - id: Session ID (alphanumeric, validated against path traversal)
   *
   * Response: Full session state (EchelonState)
   * - 200: Success with state JSON
   * - 400: Invalid session ID format
   * - 404: Session not found
   */
  router.get('/sessions/:id/state', (req, res) => {
    const { id } = req.params;

    // Validate session ID to prevent path traversal
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    try {
      const state = loadState(id);
      if (!state) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json(state);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to load session state', { session: id, error: errMsg });
      res.status(500).json({ error: 'Failed to load session state' });
    }
  });

  /**
   * GET /api/sessions/:id/transcript
   *
   * Fetch transcript markdown for a session.
   * Returns raw markdown content or 404 if transcript doesn't exist.
   *
   * Path params:
   * - id: Session ID (alphanumeric, validated against path traversal)
   *
   * Response: Markdown text
   * - 200: Success with markdown content (Content-Type: text/markdown)
   * - 400: Invalid session ID format
   * - 404: Transcript not found
   */
  router.get('/sessions/:id/transcript', (req, res) => {
    const { id } = req.params;

    // Validate session ID to prevent path traversal
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    try {
      const path = join(sessionDir(id), 'transcript.md');
      if (!existsSync(path)) {
        return res.status(404).json({ error: 'Transcript not found' });
      }

      const content = readFileSync(path, 'utf-8');
      res.type('text/markdown').send(content);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to load transcript', { session: id, error: errMsg });
      res.status(500).json({ error: 'Failed to load transcript' });
    }
  });

  return router;
}
