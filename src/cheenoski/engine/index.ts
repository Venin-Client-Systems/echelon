import type { EngineRunner, EngineName } from '../types.js';
import { ClaudeEngine } from './claude.js';
import { OpenCodeEngine } from './opencode.js';
import { CodexEngine } from './codex.js';
import { CursorEngine } from './cursor.js';
import { QwenEngine } from './qwen.js';

/** Factory function to create an engine by name */
export function createEngine(name: EngineName): EngineRunner {
  switch (name) {
    case 'claude': return new ClaudeEngine();
    case 'opencode': return new OpenCodeEngine();
    case 'codex': return new CodexEngine();
    case 'cursor': return new CursorEngine();
    case 'qwen': return new QwenEngine();
  }
}

export { BaseEngine } from './base.js';
export type { EngineSpec, ParserType } from './base.js';
export { ClaudeEngine } from './claude.js';
export { OpenCodeEngine } from './opencode.js';
export { CodexEngine } from './codex.js';
export { CursorEngine } from './cursor.js';
export { QwenEngine } from './qwen.js';
export { runWithFallback, isRateLimited } from './fallback.js';
