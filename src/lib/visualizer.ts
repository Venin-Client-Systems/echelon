/**
 * ASCII Art Visualizer for Echelon Cascade
 * Shows the organizational hierarchy and flow in real-time
 */

import type { AgentRole, AgentStatus } from './types.js';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

/**
 * Get status emoji/symbol for an agent
 */
export function getStatusSymbol(status: AgentStatus): string {
  switch (status) {
    case 'idle':
      return `${colors.dim}○${colors.reset}`;
    case 'thinking':
      return `${colors.yellow}●${colors.reset}`;
    case 'done':
      return `${colors.green}✓${colors.reset}`;
    case 'error':
      return `${colors.red}✗${colors.reset}`;
    default:
      return '○';
  }
}

/**
 * Get color for agent role
 */
function getRoleColor(role: AgentRole): string {
  switch (role) {
    case '2ic':
      return colors.cyan;
    case 'eng-lead':
      return colors.blue;
    case 'team-lead':
      return colors.magenta;
    default:
      return colors.reset;
  }
}

/**
 * Generate ASCII org chart showing current state
 */
export function generateOrgChart(agentStates: Record<AgentRole, { status: AgentStatus; cost: number }>): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${colors.bright}${colors.cyan}Hierarchical Cascade${colors.reset}`);
  lines.push('');

  // CEO (Human)
  lines.push(`  ${colors.green}👤  CEO (You)${colors.reset}`);
  lines.push(`       ${colors.dim}↓${colors.reset}`);

  // Management Layers
  const layers: Array<{ role: AgentRole; label: string }> = [
    { role: '2ic', label: '2IC (Strategic Planning)' },
    { role: 'eng-lead', label: 'Engineering Lead (Architecture)' },
    { role: 'team-lead', label: 'Team Lead (Execution)' },
  ];

  for (const { role, label } of layers) {
    const agent = agentStates[role];
    const symbol = getStatusSymbol(agent.status);
    const roleColor = getRoleColor(role);
    const cost = agent.cost > 0 ? `$${agent.cost.toFixed(2)}` : '--';

    lines.push(`  ${symbol}  ${roleColor}${label}${colors.reset} ${colors.dim}${cost}${colors.reset}`);

    if (role !== 'team-lead') {
      lines.push(`       ${colors.dim}↓${colors.reset}`);
    }
  }

  // Engineers (shown separately)
  lines.push(`       ${colors.dim}↓${colors.reset}`);
  lines.push(`  ${colors.dim}◇${colors.reset}  ${colors.yellow}Engineers (Cheenoski)${colors.reset} ${colors.dim}Parallel Execution${colors.reset}`);

  lines.push('');

  return lines.join('\n');
}

/**
 * Generate horizontal flow diagram
 */
export function generateFlowDiagram(currentLayer?: AgentRole): string {
  const layers = ['CEO', '2IC', 'Eng Lead', 'Team Lead', 'Engineers'];
  const width = 12;

  const lines: string[] = [];
  lines.push('');

  // Top border
  lines.push('  ' + layers.map(() => '┌' + '─'.repeat(width - 2) + '┐').join('   '));

  // Layer names
  const layerLine = layers.map((name, i) => {
    const padding = Math.floor((width - name.length - 2) / 2);
    const padded = ' '.repeat(padding) + name + ' '.repeat(width - name.length - padding - 2);

    // Highlight current layer
    if (currentLayer && i > 0) {
      const roles: AgentRole[] = ['2ic', 'eng-lead', 'team-lead'];
      if (roles[i - 1] === currentLayer) {
        return `${colors.yellow}│${padded}│${colors.reset}`;
      }
    }

    return `│${padded}│`;
  }).join('   ');
  lines.push('  ' + layerLine);

  // Bottom border
  lines.push('  ' + layers.map(() => '└' + '─'.repeat(width - 2) + '┘').join('   '));

  // Arrows
  const arrowLine = '  ' + ' '.repeat(width) + '→  '.repeat(layers.length - 1);
  lines.push(arrowLine);

  lines.push('');

  return lines.join('\n');
}

/**
 * Generate progress bar
 */
export function generateProgressBar(current: number, total: number, width = 40): string {
  const percentage = Math.min(100, Math.floor((current / total) * 100));
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;

  const bar = `${colors.green}${'█'.repeat(filled)}${colors.dim}${'░'.repeat(empty)}${colors.reset}`;
  const label = `${percentage}%`;

  return `${bar} ${label}`;
}

/**
 * Generate cost meter
 */
export function generateCostMeter(spent: number, budget: number, width = 40): string {
  const percentage = Math.min(100, (spent / budget) * 100);
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;

  let barColor = colors.green;
  if (percentage >= 95) barColor = colors.red;
  else if (percentage >= 90) barColor = colors.yellow;
  else if (percentage >= 75) barColor = colors.yellow;

  const bar = `${barColor}${'█'.repeat(filled)}${colors.dim}${'░'.repeat(empty)}${colors.reset}`;
  const label = `$${spent.toFixed(2)} / $${budget.toFixed(2)}`;

  return `${bar} ${label}`;
}

/**
 * Generate banner with ASCII art
 */
export function generateBanner(): string {
  return `
${colors.cyan}
  ███████╗ ██████╗██╗  ██╗███████╗██╗      ██████╗ ███╗   ██╗
  ██╔════╝██╔════╝██║  ██║██╔════╝██║     ██╔═══██╗████╗  ██║
  █████╗  ██║     ███████║█████╗  ██║     ██║   ██║██╔██╗ ██║
  ██╔══╝  ██║     ██╔══██║██╔══╝  ██║     ██║   ██║██║╚██╗██║
  ███████╗╚██████╗██║  ██║███████╗███████╗╚██████╔╝██║ ╚████║
  ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
${colors.reset}
  ${colors.dim}Hierarchical Multi-Agent AI Orchestrator${colors.reset}
  ${colors.bright}Built by George Atkinson & Claude Opus 4.6${colors.reset}
`;
}

/**
 * Generate compact status line
 */
export function generateStatusLine(
  status: string,
  cost: number,
  messages: number,
  issues: number
): string {
  const statusColor = status === 'running' ? colors.green :
                      status === 'paused' ? colors.yellow :
                      status === 'completed' ? colors.cyan : colors.red;

  return `${statusColor}●${colors.reset} ${status.toUpperCase()}  ` +
         `${colors.dim}|${colors.reset}  ` +
         `💰 $${cost.toFixed(2)}  ` +
         `${colors.dim}|${colors.reset}  ` +
         `📨 ${messages} msgs  ` +
         `${colors.dim}|${colors.reset}  ` +
         `🎫 ${issues} issues`;
}
