import { BaseEngine } from './base.js';
import type { EngineSpec } from './base.js';

const spec: EngineSpec = {
  name: 'claude',
  binary: 'claude',
  buildArgs: () => [
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
    '-p', '-',
  ],
  env: () => ({ CLAUDECODE: undefined }),
  parser: 'stream-json',
  useStdin: true,
};

export class ClaudeEngine extends BaseEngine {
  constructor() { super(spec); }
}
