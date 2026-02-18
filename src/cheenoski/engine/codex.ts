import { BaseEngine } from './base.js';
import type { EngineSpec } from './base.js';

const spec: EngineSpec = {
  name: 'codex',
  binary: 'codex',
  buildArgs: () => ['exec', '--full-auto', '--json', '-'],
  parser: 'json',
  useStdin: true,
};

export class CodexEngine extends BaseEngine {
  constructor() { super(spec); }
}
