import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EchelonConfigSchema, type EchelonConfig } from './types.js';
import { logger } from './logger.js';

export function loadConfig(configPath: string): EchelonConfig {
  const abs = resolve(configPath);
  const raw = JSON.parse(readFileSync(abs, 'utf-8'));
  const config = EchelonConfigSchema.parse(raw);

  // Warn if any layer uses haiku model
  const haikuLayers = Object.entries(config.layers)
    .filter(([_, layer]) => layer.model === 'haiku')
    .map(([name]) => name);

  if (haikuLayers.length > 0) {
    logger.warn(`Haiku model detected in layers: ${haikuLayers.join(', ')}. Haiku is fast but less capable for complex tasks.`);
  }

  return config;
}
