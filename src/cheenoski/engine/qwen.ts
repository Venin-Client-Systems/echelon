import { BaseEngine } from './base.js';
import type { EngineSpec } from './base.js';

const spec: EngineSpec = {
  name: 'qwen',
  binary: 'qwen',
  buildArgs: () => [
    '--output-format', 'stream-json',
    '--approval-mode', 'yolo',
    '-p', '-',
  ],
  parser: 'stream-json',
  useStdin: true,
};

export class QwenEngine extends BaseEngine {
  constructor() { super(spec); }
}
