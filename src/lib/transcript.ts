import { join } from 'node:path';
import { writeFileSync, appendFileSync } from 'node:fs';
import { ensureDir, sessionDir } from './paths.js';
import type { EchelonConfig, LayerMessage } from './types.js';
import { LAYER_LABELS } from './types.js';

/** Validate session ID format to prevent path injection */
function isValidSessionId(id: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(id) && !id.includes('..') && !id.includes('/') && !id.includes('\\');
}

export class TranscriptWriter {
  readonly filePath: string;

  constructor(echelonSessionId: string) {
    if (!isValidSessionId(echelonSessionId)) {
      throw new Error(`Invalid session ID: ${echelonSessionId}`);
    }

    try {
      const dir = sessionDir(echelonSessionId);
      ensureDir(dir);
      this.filePath = join(dir, 'transcript.md');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to initialize transcript: ${msg}`);
    }
  }

  writeHeader(config: EchelonConfig, directive: string): void {
    try {
      const header = [
        '# Echelon Session',
        '',
        `**Project:** ${config.project.repo}`,
        `**Directive:** ${directive}`,
        `**Started:** ${new Date().toISOString()}`,
        `**Approval Mode:** ${config.approvalMode}`,
        '',
        '---',
        '',
      ].join('\n');
      writeFileSync(this.filePath, header, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to write transcript header: ${msg}`);
    }
  }

  appendMessage(msg: LayerMessage): void {
    try {
      const label = LAYER_LABELS[msg.from] ?? msg.from;
      const entry = [
        `## ${label} → ${LAYER_LABELS[msg.to] ?? msg.to}`,
        '',
        msg.content,
        '',
        msg.actions.length > 0
          ? `**Actions:** ${msg.actions.map(a => a.action).join(', ')}`
          : null,
        '',
        `*($${msg.costUsd.toFixed(4)} | ${(msg.durationMs / 1000).toFixed(1)}s)*`,
        '',
        '---',
        '',
      ].filter(s => s !== null).join('\n');
      appendFileSync(this.filePath, entry, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to append message to transcript: ${msg}`);
    }
  }

  appendEvent(text: string): void {
    try {
      appendFileSync(this.filePath, `> ${text}\n\n`, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to append event to transcript: ${msg}`);
    }
  }

  writeSummary(totalCost: number, startTime: Date): void {
    try {
      const durationMin = ((Date.now() - startTime.getTime()) / 60_000).toFixed(1);
      const summary = [
        '',
        '---',
        '',
        `**Total Cost:** $${totalCost.toFixed(2)} | **Duration:** ${durationMin}m`,
        '',
      ].join('\n');
      appendFileSync(this.filePath, summary, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to write summary to transcript: ${msg}`);
    }
  }
}
