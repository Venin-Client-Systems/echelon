import { join } from 'node:path';
import { writeFileSync, appendFileSync } from 'node:fs';
import { ensureDir, sessionDir } from './paths.js';
import type { EchelonConfig, LayerMessage } from './types.js';
import { LAYER_LABELS } from './types.js';

export class TranscriptWriter {
  readonly filePath: string;

  constructor(echelonSessionId: string) {
    const dir = sessionDir(echelonSessionId);
    ensureDir(dir);
    this.filePath = join(dir, 'transcript.md');
  }

  writeHeader(config: EchelonConfig, directive: string): void {
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
  }

  appendMessage(msg: LayerMessage): void {
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
  }

  appendEvent(text: string): void {
    appendFileSync(this.filePath, `> ${text}\n\n`, 'utf-8');
  }

  writeSummary(totalCost: number, startTime: Date): void {
    const durationMin = ((Date.now() - startTime.getTime()) / 60_000).toFixed(1);
    const summary = [
      '',
      '---',
      '',
      `**Total Cost:** $${totalCost.toFixed(2)} | **Duration:** ${durationMin}m`,
      '',
    ].join('\n');
    appendFileSync(this.filePath, summary, 'utf-8');
  }
}
