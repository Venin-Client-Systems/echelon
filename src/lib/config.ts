import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { EchelonConfigSchema, type EchelonConfig } from './types.js';
import { logger } from './logger.js';
import type { GitRepoInfo } from './git-detect.js';

export function loadConfig(configPath: string): EchelonConfig {
  const abs = resolve(configPath);
  let text: string;
  try {
    text = readFileSync(abs, 'utf-8');
  } catch {
    throw new Error(`Config file not found: ${abs}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Config file is not valid JSON: ${abs}`);
  }

  // Apply environment variable overrides for telegram health config
  if ((raw as any).telegram) {
    // Only create health object if it exists in config OR if env vars are set
    const hasHealthEnvVars =
      process.env.ECHELON_HEALTH_ENABLED !== undefined ||
      process.env.ECHELON_HEALTH_PORT !== undefined ||
      process.env.ECHELON_HEALTH_BIND !== undefined;

    if ((raw as any).telegram.health || hasHealthEnvVars) {
      if (!(raw as any).telegram.health) {
        (raw as any).telegram.health = {};
      }

      // Override from environment variables if present
      if (process.env.ECHELON_HEALTH_ENABLED !== undefined) {
        (raw as any).telegram.health.enabled = process.env.ECHELON_HEALTH_ENABLED === 'true';
      }
      if (process.env.ECHELON_HEALTH_PORT !== undefined) {
        const port = parseInt(process.env.ECHELON_HEALTH_PORT, 10);
        if (!isNaN(port)) {
          (raw as any).telegram.health.port = port;
        }
      }
      if (process.env.ECHELON_HEALTH_BIND !== undefined) {
        (raw as any).telegram.health.bindAddress = process.env.ECHELON_HEALTH_BIND;
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

/**
 * Search for echelon.config.json in standard locations.
 * Returns the absolute path if found, null otherwise.
 */
export function discoverConfig(gitRoot?: string): string | null {
  const CONFIG_NAME = 'echelon.config.json';

  // 1. cwd
  const cwdConfig = resolve(CONFIG_NAME);
  if (existsSync(cwdConfig)) return cwdConfig;

  // 2. git root (if different from cwd)
  if (gitRoot) {
    const gitRootConfig = join(gitRoot, CONFIG_NAME);
    if (gitRootConfig !== cwdConfig && existsSync(gitRootConfig)) return gitRootConfig;
  }

  // 3. ~/.echelon/configs/<repo-slug>.json — only if we can derive the slug from gitRoot
  if (gitRoot) {
    // Derive slug from the directory name
    const slug = gitRoot.split('/').pop();
    if (slug) {
      const globalConfig = join(homedir(), '.echelon', 'configs', `${slug}.json`);
      if (existsSync(globalConfig)) return globalConfig;
    }
  }

  return null;
}

/**
 * Generate a default EchelonConfig object from detected git info.
 * No file I/O — returns an in-memory config with all Zod defaults applied.
 */
export function generateDefaultConfig(detected: GitRepoInfo): EchelonConfig {
  return EchelonConfigSchema.parse({
    project: {
      repo: detected.repo,
      path: detected.path,
      baseBranch: detected.baseBranch,
    },
  });
}
