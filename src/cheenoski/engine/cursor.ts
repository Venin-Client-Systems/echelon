import { BaseEngine } from './base.js';
import type { EngineSpec } from './base.js';

const spec: EngineSpec = {
  name: 'cursor',
  binary: 'cursor',
  buildArgs: () => [
    'agent', '--print', '--force',
    '--output-format', 'stream-json',
    '-',
  ],
  parser: 'stream-json',
  useStdin: true,
};

export class CursorEngine extends BaseEngine {
  constructor() { super(spec); }
}
