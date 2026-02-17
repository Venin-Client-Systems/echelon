import { join } from 'node:path';
import { readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { SESSIONS_DIR, readJSON } from '../lib/paths.js';
import { logger } from '../lib/logger.js';
import type { EchelonState } from '../lib/types.js';

export interface SessionSummary {
  id: string;
  repo: string;
  directive: string;
  status: EchelonState['status'];
  totalCost: number;
  messageCount: number;
  issueCount: number;
  startedAt: string;
  updatedAt: string;
}

/** List all sessions, most recent first */
export function listSessions(): SessionSummary[] {
  if (!existsSync(SESSIONS_DIR)) return [];

  const dirs = readdirSync(SESSIONS_DIR).filter(d => {
    const statePath = join(SESSIONS_DIR, d, 'state.json');
    return existsSync(statePath);
  });

  const summaries: SessionSummary[] = [];

  for (const dir of dirs) {
    try {
      const state = readJSON<EchelonState>(join(SESSIONS_DIR, dir, 'state.json'));
      if (!state || typeof state.sessionId !== 'string') continue;

      summaries.push({
        id: state.sessionId,
        repo: state.projectRepo,
        directive: state.directive,
        status: state.status,
        totalCost: state.totalCost,
        messageCount: state.messages.length,
        issueCount: state.issues.length,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
      });
    } catch {
      logger.debug(`Skipping corrupt session: ${dir}`);
    }
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Find a resumable session (most recent paused or running) */
export function findResumableSession(repo?: string): SessionSummary | null {
  const sessions = listSessions();
  const resumable = sessions.filter(s =>
    s.status === 'paused' || s.status === 'running',
  );

  if (repo) {
    return resumable.find(s => s.repo === repo) ?? null;
  }

  return resumable[0] ?? null;
}

/** Delete a session and its data */
export function deleteSession(sessionId: string): boolean {
  const dir = join(SESSIONS_DIR, sessionId);
  if (!existsSync(dir)) return false;

  rmSync(dir, { recursive: true, force: true });
  logger.info('Deleted session', { session: sessionId });
  return true;
}

/** Delete all completed/failed sessions */
export function pruneCompletedSessions(): number {
  const sessions = listSessions();
  let count = 0;

  for (const s of sessions) {
    if (s.status === 'completed' || s.status === 'failed') {
      if (deleteSession(s.id)) count++;
    }
  }

  return count;
}

/** Get disk usage of sessions directory */
export function getSessionsDiskUsage(): { count: number; bytes: number } {
  if (!existsSync(SESSIONS_DIR)) return { count: 0, bytes: 0 };

  const dirs = readdirSync(SESSIONS_DIR);
  let bytes = 0;

  for (const dir of dirs) {
    const fullPath = join(SESSIONS_DIR, dir);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const files = readdirSync(fullPath);
        for (const file of files) {
          try {
            bytes += statSync(join(fullPath, file)).size;
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
  }

  return { count: dirs.length, bytes };
}

/** Print session list to stdout */
export function printSessions(): void {
  const sessions = listSessions();

  if (sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }

  console.log(`\n${'ID'.padEnd(50)} ${'Status'.padEnd(10)} ${'Cost'.padEnd(8)} ${'Msgs'.padEnd(5)} Directive`);
  console.log('─'.repeat(100));

  for (const s of sessions) {
    const id = s.id.length > 48 ? s.id.slice(0, 48) + '..' : s.id.padEnd(50);
    const status = s.status.padEnd(10);
    const cost = `$${s.totalCost.toFixed(2)}`.padEnd(8);
    const msgs = String(s.messageCount).padEnd(5);
    const directive = s.directive.slice(0, 40);
    console.log(`${id} ${status} ${cost} ${msgs} ${directive}`);
  }

  const usage = getSessionsDiskUsage();
  console.log(`\n${sessions.length} session(s), ${(usage.bytes / 1024).toFixed(1)} KB on disk\n`);
}
