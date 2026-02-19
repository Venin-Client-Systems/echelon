#!/usr/bin/env node
/**
 * Interactive tutorial for first-time Echelon users
 * Walks through key concepts and demonstrates features
 */

import { createInterface } from 'node:readline';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
};

function log(msg: string, color = 'reset') {
  console.log(`${(colors as any)[color]}${msg}${colors.reset}`);
}

function section(title: string) {
  console.log();
  log('═'.repeat(60), 'cyan');
  log(`  ${title}`, 'bright');
  log('═'.repeat(60), 'cyan');
  console.log();
}

async function prompt(message: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${colors.green}Press Enter to continue...${colors.reset} `, () => {
      rl.close();
      resolve();
    });
  });
}

export async function runTutorial(): Promise<void> {
  console.clear();

  section('Welcome to Echelon! 🚀');

  log('This 2-minute tutorial will show you how Echelon works.', 'bright');
  console.log();
  log('Echelon is a hierarchical AI orchestrator that runs like a', 'cyan');
  log('real software engineering organization - with management layers!', 'cyan');
  console.log();

  await prompt('');

  // Part 1: The Hierarchy
  section('Part 1: The Organization 🏢');

  log('Echelon simulates a complete engineering org:', 'bright');
  console.log();
  log('  CEO (You)          ─── Gives directives, approves actions', 'yellow');
  log('    ↓');
  log('  2IC (AI)           ─── Strategic planning', 'magenta');
  log('    ↓');
  log('  Eng Lead (AI)      ─── Technical architecture', 'magenta');
  log('    ↓');
  log('  Team Lead (AI)     ─── Creates GitHub issues', 'magenta');
  log('    ↓');
  log('  Engineers (AI)     ─── Write code in parallel', 'magenta');
  console.log();

  log('Each layer has its own:', 'cyan');
  log('  • AI model (opus, sonnet, or haiku)', 'green');
  log('  • Budget limit', 'green');
  log('  • Turn limit', 'green');
  console.log();

  await prompt('');

  // Part 2: How It Works
  section('Part 2: The Cascade 🌊');

  log('Here\'s what happens when you give a directive:', 'bright');
  console.log();

  log('1. You say: "Add JWT authentication"', 'yellow');
  log('   ↓');
  log('2. 2IC breaks it into workstreams:', 'cyan');
  log('   • API token generation', 'green');
  log('   • Middleware for protected routes', 'green');
  log('   • User model updates', 'green');
  log('   ↓');
  log('3. Eng Lead designs the architecture:', 'cyan');
  log('   • Which files to modify', 'green');
  log('   • Tech stack decisions', 'green');
  log('   • Domain labels (backend, frontend, etc.)', 'green');
  log('   ↓');
  log('4. Team Lead creates GitHub issues', 'cyan');
  log('   • Detailed specifications', 'green');
  log('   • Labels and priorities', 'green');
  log('   ↓');
  log('5. Engineers (Cheenoski) execute in parallel', 'cyan');
  log('   • Write code', 'green');
  log('   • Run tests', 'green');
  log('   • Create pull requests', 'green');
  console.log();

  await prompt('');

  // Part 3: Budget & Safety
  section('Part 3: Budget & Safety 💰');

  log('Echelon has built-in cost protection:', 'bright');
  console.log();
  log('  ⚠️  75% budget → Warning', 'yellow');
  log('  ⚠️  90% budget → Warning', 'yellow');
  log('  🚨 95% budget → Auto-pause (unless --yolo)', 'yellow');
  console.log();

  log('You can set:', 'cyan');
  log('  • Per-layer budgets (2IC: $10, Eng Lead: $5, etc.)', 'green');
  log('  • Total budget cap ($50 default)', 'green');
  log('  • Approval mode (destructive, all, or none)', 'green');
  console.log();

  log('Check cost anytime:', 'bright');
  log('  $ echelon status', 'green');
  console.log();

  await prompt('');

  // Part 4: Approval Modes
  section('Part 4: Approval Modes 🎛️');

  log('Control how much autonomy Echelon has:', 'bright');
  console.log();

  log('  destructive (recommended):', 'cyan');
  log('    • You approve: Creating issues, running code, pushing PRs', 'green');
  log('    • Auto-approved: Planning, design, analysis', 'green');
  console.log();

  log('  all:', 'cyan');
  log('    • You approve everything', 'green');
  log('    • Maximum control', 'green');
  console.log();

  log('  none (or --yolo):', 'cyan');
  log('    • Everything auto-approved', 'green');
  log('    • Full autonomous mode', 'green');
  console.log();

  await prompt('');

  // Part 5: Basic Commands
  section('Part 5: Commands You\'ll Use 🎮');

  log('The main command:', 'bright');
  log('  $ echelon', 'green');
  log('  That\'s it! Interactive mode handles everything.', 'cyan');
  console.log();

  log('Other useful commands:', 'bright');
  log('  $ echelon status           # Check progress', 'green');
  log('  $ echelon --yolo           # Full autonomous', 'green');
  log('  $ echelon --help           # All commands', 'green');
  log('  $ echelon sessions         # View sessions', 'green');
  console.log();

  log('Pro tip:', 'yellow');
  log('  Enable shell completion for tab-complete magic!', 'cyan');
  log('  See: docs/SHELL-COMPLETION.md', 'cyan');
  console.log();

  await prompt('');

  // Part 6: Next Steps
  section('You\'re Ready! 🎉');

  log('Quick start:', 'bright');
  console.log();
  log('  1. Navigate to your git repo:', 'cyan');
  log('     $ cd ~/projects/my-app', 'green');
  console.log();
  log('  2. Run Echelon:', 'cyan');
  log('     $ echelon', 'green');
  console.log();
  log('  3. Follow the prompts!', 'cyan');
  log('     (First time takes 30 seconds to set up)', 'yellow');
  console.log();

  log('Resources:', 'bright');
  log('  • Cheat sheet: docs/CHEATSHEET.md', 'cyan');
  log('  • Full docs: README.md', 'cyan');
  log('  • Help: echelon --help', 'cyan');
  console.log();

  log('Built by George Atkinson & Claude Opus 4.6', 'bright');
  log('Contact: george.atkinson@venin.space', 'cyan');
  console.log();

  log('═'.repeat(60), 'cyan');
  log('  Happy orchestrating! 🚀', 'bright');
  log('═'.repeat(60), 'cyan');
  console.log();
}
