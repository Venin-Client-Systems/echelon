#!/usr/bin/env node
/**
 * Post-install message for Echelon
 * Shows helpful tips after npm install
 */

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
};

console.log(`
${colors.cyan}╔${'═'.repeat(58)}╗${colors.reset}
${colors.cyan}║${colors.reset}  ${colors.bright}Echelon AI Orchestrator${colors.reset} - Installation Complete! 🎉  ${colors.cyan}║${colors.reset}
${colors.cyan}╚${'═'.repeat(58)}╝${colors.reset}

${colors.bright}Quick Start:${colors.reset}
  ${colors.green}$${colors.reset} cd your-project
  ${colors.green}$${colors.reset} echelon

${colors.bright}Recommended:${colors.reset} Enable shell completion for tab-complete magic!
  ${colors.yellow}→${colors.reset} See: node_modules/echelon/docs/SHELL-COMPLETION.md

${colors.bright}Resources:${colors.reset}
  ${colors.cyan}•${colors.reset} Cheat Sheet: node_modules/echelon/docs/CHEATSHEET.md
  ${colors.cyan}•${colors.reset} Help: ${colors.green}echelon --help${colors.reset}
  ${colors.cyan}•${colors.reset} Docs: https://github.com/Venin-Client-Systems/echelon

${colors.bright}Built by George Atkinson & Claude Opus 4.6${colors.reset}
${colors.cyan}Contact: george.atkinson@venin.space${colors.reset}
`);
