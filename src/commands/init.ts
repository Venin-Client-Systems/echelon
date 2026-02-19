import { writeFileSync, existsSync } from 'node:fs';
import { resolve as pathResolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { detectGitRepo, type GitRepoInfo } from '../lib/git-detect.js';
import { EchelonConfigSchema, type EchelonConfig } from '../lib/types.js';

const DEFAULT_CONFIG_NAME = 'echelon.config.json';
const VALID_MODELS = new Set(['opus', 'sonnet', 'haiku']);
const VALID_APPROVAL_MODES = new Set(['destructive', 'all', 'none']);

// ── Helpers ──────────────────────────────────────────────────────────

async function ask(prompt: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` \x1b[2m[press Enter for: ${defaultValue}]\x1b[0m` : '';
  return new Promise(res => {
    rl.question(`${prompt}${suffix}: `, answer => {
      rl.close();
      const selected = answer.trim() || defaultValue || '';
      // Show what was selected if default was used
      if (!answer.trim() && defaultValue) {
        console.log(`  \x1b[2m→ Using default: ${defaultValue}\x1b[0m`);
      }
      res(selected);
    });
  });
}

async function askValidated(
  prompt: string,
  valid: Set<string>,
  defaultValue: string,
): Promise<string> {
  const validStr = [...valid].join('/');
  while (true) {
    const answer = await ask(`${prompt} \x1b[2m[${validStr}]\x1b[0m`, defaultValue);
    if (valid.has(answer)) return answer;
    console.log(`  \x1b[31mInvalid: "${answer}". Must be one of: ${validStr}\x1b[0m`);
  }
}

async function askNumber(prompt: string, defaultValue: string): Promise<number> {
  while (true) {
    const answer = await ask(prompt, defaultValue);
    const num = Number(answer);
    if (!isNaN(num) && num > 0) return num;
    console.log(`  \x1b[31mInvalid: "${answer}". Must be a positive number.\x1b[0m`);
  }
}

async function askYesNo(prompt: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await ask(`${prompt} \x1b[2m[${hint}]\x1b[0m`, defaultYes ? 'y' : 'n');
  return answer.toLowerCase().startsWith('y');
}

function ok(msg: string): void { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg: string): void { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }
function info(msg: string): void { console.log(`  \x1b[36m→\x1b[0m ${msg}`); }
function heading(msg: string): void { console.log(`\n  \x1b[1m\x1b[36m${msg}\x1b[0m\n`); }
function dim(msg: string): void { console.log(`  \x1b[2m${msg}\x1b[0m`); }

// ── Prereq Checks ───────────────────────────────────────────────────

interface PrereqResult {
  name: string;
  installed: boolean;
  authenticated: boolean;
  version?: string;
  detail?: string;
}

function checkClaude(): PrereqResult {
  const result: PrereqResult = { name: 'Claude CLI', installed: false, authenticated: false };
  try {
    const version = execFileSync('claude', ['--version'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).trim();
    result.installed = true;
    result.version = version;
  } catch (err) {
    // Check if it's a timeout or command not found
    const msg = err instanceof Error && 'code' in err ? String((err as any).code) : '';
    if (msg === 'ENOENT') {
      result.detail = 'Install: npm install -g @anthropic-ai/claude-code';
    }
    return result;
  }

  // Check if authenticated by trying a cheap operation
  try {
    execFileSync('claude', ['-p', 'echo test', '--output-format', 'json', '--max-turns', '0'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    result.authenticated = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    // max-turns 0 may exit non-zero but that's fine if it got past auth
    if (msg.includes('API key') || msg.includes('unauthorized') || msg.includes('authentication')) {
      result.detail = 'Run: claude login';
    } else {
      // Probably authenticated but max-turns 0 caused a benign error
      result.authenticated = true;
    }
  }
  return result;
}

function checkGh(): PrereqResult {
  const result: PrereqResult = { name: 'GitHub CLI', installed: false, authenticated: false };
  try {
    const version = execFileSync('gh', ['--version'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).trim().split('\n')[0];
    result.installed = true;
    result.version = version;
  } catch (err) {
    const msg = err instanceof Error && 'code' in err ? String((err as any).code) : '';
    if (msg === 'ENOENT') {
      result.detail = 'Install: https://cli.github.com';
    }
    return result;
  }

  try {
    execFileSync('gh', ['auth', 'status'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
    result.authenticated = true;
  } catch {
    result.detail = 'Run: gh auth login';
  }
  return result;
}

function checkGit(): PrereqResult {
  const result: PrereqResult = { name: 'Git', installed: false, authenticated: false };
  try {
    const version = execFileSync('git', ['--version'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).trim();
    result.installed = true;
    result.authenticated = true; // git doesn't have an auth step
    result.version = version;
  } catch (err) {
    const msg = err instanceof Error && 'code' in err ? String((err as any).code) : '';
    if (msg === 'ENOENT') {
      result.detail = 'Install: https://git-scm.com';
    }
  }
  return result;
}

function checkNode(): PrereqResult {
  const version = process.version;
  const major = parseInt(version.slice(1), 10);
  return {
    name: 'Node.js',
    installed: true,
    authenticated: true,
    version: version,
    detail: major < 20 ? 'Requires Node.js 20+. Upgrade: https://nodejs.org' : undefined,
  };
}

// ── Git Repo Detection ──────────────────────────────────────────────
// detectGitRepo() is imported from ../lib/git-detect.js

// ── Main ────────────────────────────────────────────────────────────

export async function runInit(): Promise<void> {
  console.log('');
  console.log('  \x1b[1m\x1b[36m╔══════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[1m\x1b[36m║\x1b[0m         \x1b[1mEchelon Setup Wizard\x1b[0m         \x1b[1m\x1b[36m║\x1b[0m');
  console.log('  \x1b[1m\x1b[36m║\x1b[0m   Hierarchical AI Org Orchestrator   \x1b[1m\x1b[36m║\x1b[0m');
  console.log('  \x1b[1m\x1b[36m╚══════════════════════════════════════╝\x1b[0m');

  // ── Step 1: Prerequisites ───────────────────────────────────────

  heading('Step 1 — Prerequisites');

  const checks = [checkNode(), checkGit(), checkClaude(), checkGh()];
  let allGood = true;

  for (const check of checks) {
    if (!check.installed) {
      fail(`${check.name} — not installed`);
      if (check.detail) dim(`  ${check.detail}`);
      allGood = false;
    } else if (!check.authenticated) {
      fail(`${check.name} ${check.version ? `(${check.version})` : ''} — not authenticated`);
      if (check.detail) dim(`  ${check.detail}`);
      allGood = false;
    } else {
      ok(`${check.name} ${check.version ? `(${check.version})` : ''}`);
    }
  }

  if (!allGood) {
    console.log('');
    const proceed = await askYesNo('  Some prerequisites are missing. Continue anyway?', false);
    if (!proceed) {
      console.log('\n  Fix the issues above and run \x1b[1mechelon init\x1b[0m again.\n');
      return;
    }
  }

  // ── Validate GitHub Token Permissions ───────────────────────────
  // Check if gh is authenticated and has necessary scopes
  if (checks[3].authenticated) {
    try {
      const tokenInfo = execFileSync('gh', ['auth', 'status', '-t'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000
      });

      // Check for required scopes: repo, workflow, project
      const hasRepo = tokenInfo.includes('repo');
      const hasWorkflow = tokenInfo.includes('workflow');

      if (!hasRepo) {
        console.log('');
        info('GitHub token missing "repo" scope (required for issue creation).');
        info('Re-authenticate: gh auth login --scopes repo,workflow');
        console.log('');
      }

      if (!hasWorkflow) {
        console.log('');
        info('GitHub token missing "workflow" scope (recommended for CI/CD).');
        info('This is optional but recommended for full functionality.');
        console.log('');
      }
    } catch {
      // gh auth status -t failed, token might be expired or scopes not readable
      // Continue anyway, we already checked basic auth earlier
    }
  }

  // ── Step 2: Project ─────────────────────────────────────────────

  heading('Step 2 — Project');

  const detected = detectGitRepo();
  if (detected) {
    ok(`Detected: ${detected.repo}`);
    dim(`Path: ${detected.path}`);
    dim(`Branch: ${detected.baseBranch}`);
    console.log('');
  } else {
    info('No git repo detected in current directory.');
    info('Run this command from inside your project repo.');
    console.log('');
  }

  let repo = await ask('  GitHub repo (owner/repo)', detected?.repo);
  // Validate repo format
  while (repo && !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
    console.log('  \x1b[31mInvalid repo format. Must be "owner/repo"\x1b[0m');
    repo = await ask('  GitHub repo (owner/repo)', detected?.repo);
  }

  const repoPath = await ask('  Repo path', detected?.path || process.cwd());
  const baseBranch = await ask('  Base branch', detected?.baseBranch || 'main');

  // ── Step 3: AI Models ───────────────────────────────────────────

  heading('Step 3 — AI Models');

  dim('Choose which Claude model powers each management layer.');
  dim('opus = most capable ($$$)  |  sonnet = balanced ($$)  |  haiku = fast ($)');
  console.log('');

  const model2ic = await askValidated('  2IC (strategy)', VALID_MODELS, 'opus');
  const modelEng = await askValidated('  Eng Lead (architecture)', VALID_MODELS, 'sonnet');
  const modelTL = await askValidated('  Team Lead (execution)', VALID_MODELS, 'sonnet');

  // ── Step 4: Budget & Safety ─────────────────────────────────────

  heading('Step 4 — Budget & Safety');

  dim('Set spending limits to prevent runaway costs.');
  console.log('');

  const budgetNum = await askNumber('  Max total budget ($)', '50');
  const maxParallelNum = await askNumber('  Max parallel engineers', '3');

  console.log('');
  dim('Approval modes:');
  dim('  destructive — CEO approves issue creation & code execution (recommended)');
  dim('  all         — CEO approves every action');
  dim('  none        — fully autonomous (no human approval)');
  console.log('');

  const approvalMode = await askValidated('  Approval mode', VALID_APPROVAL_MODES, 'destructive');

  // ── Step 5: Telegram (Optional) ─────────────────────────────────

  heading('Step 5 — Telegram Bot (Optional)');

  dim('Run Echelon as a Telegram bot for mobile-first operation.');
  dim('Leave blank to skip Telegram setup.');
  console.log('');

  const setupTelegram = await askYesNo('  Configure Telegram bot?', false);
  let telegramConfig: any = undefined;

  if (setupTelegram) {
    console.log('');
    dim('Get your bot token from @BotFather on Telegram.');
    dim('Get your chat ID by messaging your bot and checking logs.');
    console.log('');

    const botToken = await ask('  Bot token', '');
    const chatId = await ask('  Chat ID', '');
    const allowedUsers = await ask('  Allowed user IDs (comma-separated)', '');

    // Validate bot token format: should be like "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
    if (botToken && !/^\d+:[\w-]+$/.test(botToken)) {
      console.log('');
      info('⚠️  Invalid token format. Should be "123456:ABC..." from @BotFather');
      info('Skipping Telegram setup. Run echelon init again to retry.');
      console.log('');
    } else if (botToken && chatId) {
      // Validate chat ID is numeric
      if (!/^\d+$/.test(chatId)) {
        console.log('');
        info('⚠️  Invalid chat ID format. Should be numeric (e.g., "123456789")');
        info('Get it from: https://api.telegram.org/bot<TOKEN>/getUpdates');
        info('Skipping Telegram setup. Run echelon init again to retry.');
        console.log('');
      } else {
        telegramConfig = {
          token: botToken,
          chatId: chatId,
          allowedUserIds: allowedUsers ? allowedUsers.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)) : [],
          health: {
            enabled: true,
            port: 3000,
          },
        };
        ok('Telegram configured');
      }
    } else {
      info('Skipping Telegram (token or chat ID missing)');
    }
  }

  // ── Step 6: Engineer Configuration ──────────────────────────────

  heading('Step 6 — Engineer Configuration');

  dim('Cheenoski supports multiple AI backends (engines) for code execution.');
  dim('Default: claude (Claude Code). Others: opencode, codex, cursor, qwen.');
  console.log('');

  const engineName = await ask('  Primary engine', 'claude');
  if (!['claude', 'opencode', 'codex', 'cursor', 'qwen'].includes(engineName)) {
    info(`Unknown engine "${engineName}", defaulting to claude`);
  }

  console.log('');
  dim('Billing mode affects how Anthropic API usage is calculated:');
  dim('  • api  — Standard API pricing (recommended)');
  dim('  • max  — Claude Pro/Max plan (lower limits, no per-token billing)');
  console.log('');

  const billingMode = await ask('  Billing mode (api/max)', 'api');

  // ── Step 7: Project Board (Optional) ────────────────────────────

  heading('Step 7 — GitHub Project Board (Optional)');

  dim('Integrate with GitHub Projects v2 for tracking issue status.');
  dim('Requires project number from your GitHub org/repo project settings.');
  console.log('');

  const setupBoard = await askYesNo('  Configure project board?', false);
  let projectBoard: any = undefined;

  if (setupBoard) {
    console.log('');
    dim('Find project number in GitHub: Settings → Projects → (project URL has /projects/:number)');
    console.log('');

    const projectNumber = await ask('  Project number', '');
    if (projectNumber && !isNaN(parseInt(projectNumber, 10))) {
      projectBoard = {
        projectNumber: parseInt(projectNumber, 10),
        statusField: 'Status',  // Default field names
        batchField: 'Batch',
        branchField: 'Branch',
      };
      ok('Project board configured');
    } else {
      info('Skipping project board (invalid number)');
    }
  }

  // ── Build Config ────────────────────────────────────────────────

  const config: any = {
    project: {
      repo,
      path: pathResolve(repoPath),
      baseBranch,
    },
    layers: {
      '2ic': {
        model: model2ic,
        maxBudgetUsd: Math.round(budgetNum * 0.2 * 100) / 100,
      },
      'eng-lead': {
        model: modelEng,
        maxBudgetUsd: Math.round(budgetNum * 0.1 * 100) / 100,
      },
      'team-lead': {
        model: modelTL,
        maxBudgetUsd: Math.round(budgetNum * 0.1 * 100) / 100,
      },
    },
    engineers: {
      engine: engineName || 'claude',
      maxParallel: Math.floor(maxParallelNum),
      createPr: true,
      prDraft: true,
    },
    approvalMode,
    maxTotalBudgetUsd: budgetNum,
    billing: billingMode === 'max' ? 'max' : 'api',
  };

  // Add optional configs
  if (telegramConfig) {
    config.telegram = telegramConfig;
  }
  if (projectBoard) {
    config.engineers.projectBoard = projectBoard;
  }

  // ── Write Config ────────────────────────────────────────────────

  heading('Setup Complete');

  const outPath = pathResolve(DEFAULT_CONFIG_NAME);
  if (existsSync(outPath)) {
    const overwrite = await askYesNo(`  ${DEFAULT_CONFIG_NAME} already exists. Overwrite?`, false);
    if (!overwrite) {
      console.log('  Aborted.\n');
      return;
    }
  }

  writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  ok(`Config written to ${outPath}`);

  // ── Summary ─────────────────────────────────────────────────────

  console.log('');
  console.log('  \x1b[2m┌─────────────────────────────────────────┐\x1b[0m');
  console.log(`  \x1b[2m│\x1b[0m  Project:  \x1b[1m${repo.padEnd(29)}\x1b[0m\x1b[2m│\x1b[0m`);
  console.log(`  \x1b[2m│\x1b[0m  Budget:   \x1b[1m$${budgetNum.toString().padEnd(28)}\x1b[0m\x1b[2m│\x1b[0m`);
  console.log(`  \x1b[2m│\x1b[0m  Approval: \x1b[1m${approvalMode.padEnd(29)}\x1b[0m\x1b[2m│\x1b[0m`);
  console.log(`  \x1b[2m│\x1b[0m  Models:   \x1b[1m${model2ic}/${modelEng}/${modelTL}${''.padEnd(29 - (model2ic + modelEng + modelTL).length - 2)}\x1b[0m\x1b[2m│\x1b[0m`);
  console.log('  \x1b[2m└─────────────────────────────────────────┘\x1b[0m');

  console.log('');
  console.log('  \x1b[33m💡 Budget Tracking:\x1b[0m');
  console.log('     Budget limits work with Anthropic API (pay-as-you-go).');
  console.log('     If using Claude.ai Pro/Team, Echelon will auto-detect and');
  console.log('     use turn limits instead for safety.');

  console.log('');
  console.log('  \x1b[1mNext steps:\x1b[0m');
  console.log('');
  console.log('  \x1b[36m1.\x1b[0m Test with a dry run:');
  console.log(`     \x1b[1mechelon -c ${DEFAULT_CONFIG_NAME} -d "analyze the codebase" --dry-run\x1b[0m`);
  console.log('');
  console.log('  \x1b[36m2.\x1b[0m Run headless (safe, read-only directive):');
  console.log(`     \x1b[1mechelon -c ${DEFAULT_CONFIG_NAME} -d "list top 3 improvements" --headless\x1b[0m`);
  console.log('');
  console.log('  \x1b[36m3.\x1b[0m Launch the TUI:');
  console.log(`     \x1b[1mechelon -c ${DEFAULT_CONFIG_NAME}\x1b[0m`);
  console.log('');
}

// ── Quick Init (first-run auto-discovery) ────────────────────────────

export async function runQuickInit(detected: GitRepoInfo): Promise<EchelonConfig> {
  console.log('');
  info(`Detected: \x1b[1m${detected.repo}\x1b[0m`);
  dim(`Path: ${detected.path}`);
  console.log('');

  const approvalMode = await askValidated(
    '  Approval mode',
    VALID_APPROVAL_MODES,
    'destructive',
  );

  const config = EchelonConfigSchema.parse({
    project: {
      repo: detected.repo,
      path: detected.path,
      baseBranch: detected.baseBranch,
    },
    approvalMode,
  });

  // Write config to git root
  const outPath = join(detected.path, DEFAULT_CONFIG_NAME);
  writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  ok(`Config written to ${outPath}`);
  console.log('');

  return config;
}
