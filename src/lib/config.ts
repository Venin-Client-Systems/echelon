import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EchelonConfigSchema, type EchelonConfig } from './types.js';
import { logger } from './logger.js';

export function loadConfig(configPath: string): EchelonConfig {
  const abs = resolve(configPath);
  const raw = JSON.parse(readFileSync(abs, 'utf-8'));

  // Apply environment variable overrides for telegram health config
  if (raw.telegram) {
    // Only create health object if it exists in config OR if env vars are set
    const hasHealthEnvVars =
      process.env.ECHELON_HEALTH_ENABLED !== undefined ||
      process.env.ECHELON_HEALTH_PORT !== undefined ||
      process.env.ECHELON_HEALTH_BIND !== undefined;

    if (raw.telegram.health || hasHealthEnvVars) {
      if (!raw.telegram.health) {
        raw.telegram.health = {};
      }

      // Override from environment variables if present
      if (process.env.ECHELON_HEALTH_ENABLED !== undefined) {
        raw.telegram.health.enabled = process.env.ECHELON_HEALTH_ENABLED === 'true';
      }
      if (process.env.ECHELON_HEALTH_PORT !== undefined) {
        const port = parseInt(process.env.ECHELON_HEALTH_PORT, 10);
        if (!isNaN(port)) {
          raw.telegram.health.port = port;
        }
      }
      if (process.env.ECHELON_HEALTH_BIND !== undefined) {
        raw.telegram.health.bindAddress = process.env.ECHELON_HEALTH_BIND;
      }
    }
  }

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
