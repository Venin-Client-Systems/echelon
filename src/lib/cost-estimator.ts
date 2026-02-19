import type { EchelonConfig } from './types.js';

/**
 * Cost estimation for cascade execution.
 * Provides rough cost estimates based on directive complexity and layer configs.
 */

/** Anthropic API pricing (as of 2025-01) */
const MODEL_PRICING = {
  'opus': { input: 15.00 / 1_000_000, output: 75.00 / 1_000_000 },
  'sonnet': { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
  'haiku': { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
} as const;

interface CostEstimate {
  minCost: number;
  maxCost: number;
  perLayer: {
    role: '2ic' | 'eng-lead' | 'team-lead';
    model: string;
    minCost: number;
    maxCost: number;
  }[];
  breakdown: string;
}

/**
 * Estimate directive complexity based on length and keywords.
 * Returns a multiplier (0.5 = simple, 1.0 = medium, 2.0 = complex, 3.0+ = very complex)
 */
function estimateComplexity(directive: string): number {
  const length = directive.length;
  const words = directive.split(/\s+/).length;

  // Base complexity from length
  let complexity = 1.0;

  if (length < 100) complexity = 0.5; // Very short directive
  else if (length > 500) complexity = 2.0; // Long directive
  else if (length > 1000) complexity = 3.0; // Very long directive

  // Adjust based on keywords indicating complexity
  const complexKeywords = [
    'refactor', 'migrate', 'redesign', 'architecture', 'database',
    'authentication', 'authorization', 'integration', 'api', 'testing',
    'performance', 'security', 'infrastructure', 'deployment',
  ];

  const simpleKeywords = [
    'add', 'fix', 'update', 'change', 'remove', 'typo', 'rename',
  ];

  const directiveLower = directive.toLowerCase();
  const complexCount = complexKeywords.filter(kw => directiveLower.includes(kw)).length;
  const simpleCount = simpleKeywords.filter(kw => directiveLower.includes(kw)).length;

  if (complexCount > 3) complexity *= 1.5;
  if (simpleCount > 0 && complexCount === 0) complexity *= 0.7;

  // Multiple sentences indicate more complex task
  const sentences = directive.split(/[.!?]+/).filter(s => s.trim()).length;
  if (sentences > 3) complexity *= 1.2;

  return Math.max(0.5, Math.min(5.0, complexity)); // Clamp between 0.5x and 5.0x
}

/**
 * Estimate token counts for a layer based on directive and complexity.
 * Returns { input, output } token estimates.
 */
function estimateLayerTokens(
  role: '2ic' | 'eng-lead' | 'team-lead',
  directiveLength: number,
  complexity: number,
): { input: number; output: number } {
  // Base estimates (conservative)
  const baseEstimates = {
    '2ic': { input: 2000, output: 1500 },        // Strategy layer
    'eng-lead': { input: 3000, output: 2500 },   // Technical design
    'team-lead': { input: 2500, output: 2000 },  // Execution coordination
  };

  const base = baseEstimates[role];

  // Scale by directive length (rough: 4 chars per token)
  const directiveTokens = Math.ceil(directiveLength / 4);

  // Apply complexity multiplier
  const input = Math.ceil((base.input + directiveTokens) * complexity);
  const output = Math.ceil(base.output * complexity);

  return { input, output };
}

/**
 * Estimate total cascade cost based on directive and config.
 * Provides min/max range accounting for variance in agent output.
 */
export function estimateCascadeCost(directive: string, config: EchelonConfig): CostEstimate {
  const complexity = estimateComplexity(directive);
  const perLayer: CostEstimate['perLayer'] = [];

  let totalMin = 0;
  let totalMax = 0;

  for (const role of ['2ic', 'eng-lead', 'team-lead'] as const) {
    const layerConfig = config.layers[role];
    const model = layerConfig.model;
    const pricing = MODEL_PRICING[model];

    const tokens = estimateLayerTokens(role, directive.length, complexity);

    // Min estimate: assume efficient execution (0.7x base)
    const minInputCost = (tokens.input * 0.7) * pricing.input;
    const minOutputCost = (tokens.output * 0.7) * pricing.output;
    const minCost = minInputCost + minOutputCost;

    // Max estimate: assume verbose execution (1.5x base)
    const maxInputCost = (tokens.input * 1.5) * pricing.input;
    const maxOutputCost = (tokens.output * 1.5) * pricing.output;
    const maxCost = maxInputCost + maxOutputCost;

    perLayer.push({ role, model, minCost, maxCost });
    totalMin += minCost;
    totalMax += maxCost;
  }

  // Build breakdown string
  const breakdown = perLayer
    .map(l => `  ${l.role}: $${l.minCost.toFixed(3)} - $${l.maxCost.toFixed(3)} (${l.model})`)
    .join('\n');

  return {
    minCost: totalMin,
    maxCost: totalMax,
    perLayer,
    breakdown,
  };
}

/**
 * Format cost estimate for display to user.
 */
export function formatCostEstimate(estimate: CostEstimate, complexity: number): string {
  const complexityLabel =
    complexity < 0.7 ? 'Simple' :
    complexity < 1.5 ? 'Medium' :
    complexity < 2.5 ? 'Complex' : 'Very Complex';

  return [
    `Estimated cascade cost: $${estimate.minCost.toFixed(2)} - $${estimate.maxCost.toFixed(2)}`,
    `Complexity: ${complexityLabel} (${complexity.toFixed(1)}x)`,
    '',
    'Per-layer breakdown:',
    estimate.breakdown,
    '',
    'Note: Actual cost may vary based on agent turns and action execution.',
  ].join('\n');
}
