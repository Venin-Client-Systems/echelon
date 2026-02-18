import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { EchelonConfigSchema, type EchelonConfig } from './types.js';
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
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Config file is not valid JSON: ${abs}`);
  }
  return EchelonConfigSchema.parse(raw);
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
