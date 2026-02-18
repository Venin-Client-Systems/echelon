import { join } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import { atomicWriteJSON, readJSON, sessionDir, ensureDir, SESSIONS_DIR } from '../lib/paths.js';
import { logger } from '../lib/logger.js';
import type { EchelonState, EchelonConfig, AgentRole, AgentStatus } from '../lib/types.js';
import { LAYER_ORDER } from '../lib/types.js';

function makeAgentState(role: AgentRole): EchelonState['agents'][AgentRole] {
  return {
    role,
    status: 'idle',
    sessionId: null,
    totalCost: 0,
    turnsCompleted: 0,
    lastError: null,
  };
}

/** Validate session ID format to prevent path injection */
function isValidSessionId(id: string): boolean {
  // Must be alphanumeric with hyphens, no path separators
  return /^[a-zA-Z0-9-]+$/.test(id) && !id.includes('..') && !id.includes('/') && !id.includes('\\');
}

/** Create a fresh session state */
export function createState(config: EchelonConfig, directive: string): EchelonState {
  const now = new Date().toISOString();
  const sessionId = `${config.project.repo.replace(/[^a-zA-Z0-9-]/g, '-')}-${now.slice(0, 19).replace(/[:.]/g, '-')}`;

  if (!isValidSessionId(sessionId)) {
    throw new Error(`Generated invalid session ID: ${sessionId}`);
  }

  const agents = {} as EchelonState['agents'];
  for (const role of LAYER_ORDER) {
    agents[role] = makeAgentState(role);
  }

  return {
    sessionId,
    projectRepo: config.project.repo,
    status: 'running',
    agents,
    messages: [],
    plan: null,
    issues: [],
    totalCost: 0,
    startedAt: now,
    updatedAt: now,
    directive,
  };
}

/** Save state atomically */
export function saveState(state: EchelonState): void {
  if (!isValidSessionId(state.sessionId)) {
    throw new Error(`Invalid session ID: ${state.sessionId}`);
  }

  try {
    state.updatedAt = new Date().toISOString();
    const dir = sessionDir(state.sessionId);
    ensureDir(dir);
    const path = join(dir, 'state.json');
    atomicWriteJSON(path, state);
    logger.debug('State saved', { session: state.sessionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to save state', { session: state.sessionId, error: msg });
    throw new Error(`State save failed: ${msg}`);
  }
}

/** Validate that a parsed object looks like EchelonState */
function isValidState(obj: unknown): obj is EchelonState {
  if (!obj || typeof obj !== 'object') return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.sessionId === 'string' &&
    typeof s.projectRepo === 'string' &&
    typeof s.status === 'string' &&
    typeof s.directive === 'string' &&
    typeof s.totalCost === 'number' &&
    Array.isArray(s.messages) &&
    Array.isArray(s.issues) &&
    s.agents !== null && typeof s.agents === 'object'
  );
}

/** Load state from a session. Returns null if missing or corrupt. */
export function loadState(sessionId: string): EchelonState | null {
  if (!isValidSessionId(sessionId)) {
    logger.warn('Invalid session ID format', { session: sessionId });
    return null;
  }

  try {
    const path = join(sessionDir(sessionId), 'state.json');
    const data = readJSON<EchelonState>(path);
    if (!isValidState(data)) {
      if (data !== null) logger.warn('Corrupt session state', { session: sessionId });
      return null;
    }
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug('Failed to load state', { session: sessionId, error: msg });
    return null;
  }
}

/** Find the most recent session for a repo */
export function findLatestSession(repo: string): string | null {
  if (!existsSync(SESSIONS_DIR)) return null;

  // Must match the same sanitization as createState uses for sessionId generation
  const prefix = repo.replace(/[^a-zA-Z0-9-]/g, '-');
  const dirs = readdirSync(SESSIONS_DIR)
    .filter(d => d.startsWith(prefix))
    .sort()
    .reverse();

  return dirs[0] ?? null;
}

/** Update an agent's status */
export function updateAgentStatus(
  state: EchelonState,
  role: AgentRole,
  status: AgentStatus,
): void {
  if (!state.agents[role]) {
    throw new Error(`Agent role not found: ${role}`);
  }
  state.agents[role].status = status;
}
