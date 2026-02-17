import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EchelonConfigSchema, type EchelonConfig } from './types.js';

export function loadConfig(configPath: string): EchelonConfig {
  const abs = resolve(configPath);
  const raw = JSON.parse(readFileSync(abs, 'utf-8'));
  return EchelonConfigSchema.parse(raw);
}
