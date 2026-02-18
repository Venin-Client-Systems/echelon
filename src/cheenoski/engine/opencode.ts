import { BaseEngine } from './base.js';
import type { EngineSpec } from './base.js';

const spec: EngineSpec = {
  name: 'opencode',
  binary: 'opencode',
  buildArgs: (_opts, promptFile) => ['run', '--format', 'json', '--file', promptFile!],
  env: () => ({ OPENCODE_PERMISSION: 'auto-edit,auto-run' }),
  parser: 'json',
};

export class OpenCodeEngine extends BaseEngine {
  constructor() { super(spec); }
}
