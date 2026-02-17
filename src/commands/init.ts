import { writeFileSync, existsSync } from 'node:fs';
import { resolve as pathResolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const DEFAULT_CONFIG_NAME = 'echelon.config.json';
const VALID_MODELS = new Set(['opus', 'sonnet', 'haiku']);
const VALID_APPROVAL_MODES = new Set(['destructive', 'all', 'none']);

async function ask(prompt: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise(res => {
    rl.question(`${prompt}${suffix}: `, answer => {
      rl.close();
      res(answer.trim() || defaultValue || '');
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
    const answer = await ask(`${prompt} (${validStr})`, defaultValue);
    if (valid.has(answer)) return answer;
    console.log(`  Invalid: "${answer}". Must be one of: ${validStr}`);
  }
}

async function askNumber(prompt: string, defaultValue: string): Promise<number> {
  while (true) {
    const answer = await ask(prompt, defaultValue);
    const num = Number(answer);
    if (!isNaN(num) && num > 0) return num;
    console.log(`  Invalid: "${answer}". Must be a positive number.`);
  }
}

function detectGitRepo(): { repo: string; path: string; branch: string } | null {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const match = remote.match(/[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
    const repo = match ? match[1] : '';

    const path = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    return { repo, path, branch };
  } catch {
    return null;
  }
}

function checkPrerequisites(): string[] {
  const missing: string[] = [];

  try {
    execFileSync('claude', ['--version'], { stdio: 'pipe' });
  } catch {
    missing.push('claude CLI (https://claude.ai/cli)');
  }

  try {
    execFileSync('gh', ['--version'], { stdio: 'pipe' });
  } catch {
    missing.push('gh CLI (https://cli.github.com)');
  }

  return missing;
}

export async function runInit(): Promise<void> {
  console.log('\n  Echelon — Init\n');

  // Check prerequisites
  const missing = checkPrerequisites();
  if (missing.length > 0) {
    console.log('  Missing prerequisites:');
    for (const m of missing) console.log(`    - ${m}`);
    console.log('');
  }

  // Detect git repo
  const detected = detectGitRepo();
  if (detected) {
    console.log(`  Detected repo: ${detected.repo}`);
    console.log(`  Path: ${detected.path}`);
    console.log('');
  }

  // Gather info
  const repo = await ask('  GitHub repo (owner/repo)', detected?.repo);
  const repoPath = await ask('  Repo path', detected?.path || process.cwd());
  const baseBranch = await ask('  Base branch', detected?.branch || 'main');

  console.log('');
  const model2ic = await askValidated('  2IC model', VALID_MODELS, 'opus');
  const modelEng = await askValidated('  Eng Lead model', VALID_MODELS, 'sonnet');
  const modelTL = await askValidated('  Team Lead model', VALID_MODELS, 'sonnet');

  console.log('');
  const budgetNum = await askNumber('  Max total budget ($)', '50');
  const maxParallelNum = await askNumber('  Max parallel engineers', '3');
  const approvalMode = await askValidated('  Approval mode', VALID_APPROVAL_MODES, 'destructive');

  // Build config
  const config = {
    project: {
      repo,
      path: pathResolve(repoPath),
      baseBranch,
    },
    layers: {
      '2ic': {
        model: model2ic,
        maxBudgetUsd: budgetNum * 0.2,
      },
      'eng-lead': {
        model: modelEng,
        maxBudgetUsd: budgetNum * 0.1,
      },
      'team-lead': {
        model: modelTL,
        maxBudgetUsd: budgetNum * 0.1,
      },
    },
    engineers: {
      maxParallel: Math.floor(maxParallelNum),
      createPr: true,
      prDraft: true,
    },
    approvalMode,
    maxTotalBudgetUsd: budgetNum,
  };

  // Write config
  const outPath = pathResolve(DEFAULT_CONFIG_NAME);
  if (existsSync(outPath)) {
    const overwrite = await ask(`\n  ${DEFAULT_CONFIG_NAME} exists. Overwrite? (y/n)`, 'n');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('  Aborted.\n');
      return;
    }
  }

  writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log(`\n  Config written to ${outPath}`);
  console.log('');
  console.log('  Next steps:');
  console.log(`    echelon --config ${DEFAULT_CONFIG_NAME} --directive "your directive"`);
  console.log(`    echelon --config ${DEFAULT_CONFIG_NAME}   # TUI mode`);
  console.log('');
}
