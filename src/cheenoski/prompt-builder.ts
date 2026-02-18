import type { CheenoskiIssue, Domain } from './types.js';
import type { EchelonConfig } from '../lib/types.js';

/**
 * Build the engineer prompt from an issue body.
 * Includes scope rules, file ownership boundaries, and step instructions.
 */
export function buildEngineerPrompt(
  issue: CheenoskiIssue,
  domain: Domain | 'unknown',
  config: EchelonConfig,
  lessonsContext?: string,
): string {
  const sections: string[] = [];

  // Sanitize issue title to prevent prompt injection
  const safeTitle = sanitizeForPrompt(issue.title);

  // Header
  sections.push(`# Task: ${safeTitle}`);
  sections.push(`Issue #${issue.number} in ${config.project.repo}`);
  sections.push('');

  // Issue body (the main spec) - preserve as-is but with size limit
  sections.push('## Specification');
  sections.push(limitPromptSize(issue.body, 50000)); // Cap at 50k chars
  sections.push('');

  // Scope rules based on domain
  sections.push('## Scope Rules');
  sections.push(buildScopeRules(domain, config));
  sections.push('');

  // Step-by-step instructions
  sections.push('## Process');
  sections.push([
    '1. Read and understand the full specification above',
    '2. Explore the codebase to understand existing patterns and conventions',
    '3. Implement the changes described in the specification',
    '4. Run any existing tests to verify your changes don\'t break anything',
    '5. If tests exist for the area you changed, run them specifically',
    '6. Commit your changes with a descriptive message referencing #' + issue.number,
    '',
    'IMPORTANT:',
    '- Follow existing code patterns and conventions in this repository',
    '- Do NOT modify files outside your domain scope unless absolutely necessary',
    '- If you encounter a blocker, describe it clearly in your output',
    '- Do NOT push to remote — Cheenoski handles branch management',
  ].join('\n'));
  sections.push('');

  // Commit message format
  sections.push('## Commit Message Format');
  sections.push(`Use: \`<type>(<scope>): <description> (#${issue.number})\``);
  sections.push('Types: feat, fix, refactor, test, docs, chore');
  sections.push('');

  // Lessons from previous runs
  if (lessonsContext) {
    sections.push('## Lessons from Previous Runs');
    sections.push(limitPromptSize(lessonsContext, 10000)); // Cap lessons at 10k chars
    sections.push('');
  }

  const fullPrompt = sections.join('\n');

  // Final safety check: cap total prompt size
  if (fullPrompt.length > 100000) {
    return fullPrompt.slice(0, 100000) + '\n\n[Prompt truncated due to size]';
  }

  return fullPrompt;
}

/** Sanitize text to prevent prompt injection attacks */
function sanitizeForPrompt(text: string): string {
  // Remove common prompt injection patterns while preserving readability
  return text
    .replace(/```[\s\S]*?```/g, '[code block]') // Remove code blocks
    .replace(/<\/?[^>]+(>|$)/g, '') // Remove HTML tags
    .slice(0, 500); // Reasonable title length
}

/** Limit text size while preserving readability */
function limitPromptSize(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars) + '\n\n[Content truncated due to size]';
}

function buildScopeRules(domain: Domain | 'unknown', config: EchelonConfig): string {
  const rules: string[] = [];

  switch (domain) {
    case 'backend':
      rules.push('You are working on BACKEND code.');
      rules.push('Focus on: src/api/, src/server/, src/lib/, src/core/, src/services/');
      rules.push('Avoid modifying: UI components, CSS, frontend-specific files');
      break;
    case 'frontend':
      rules.push('You are working on FRONTEND code.');
      rules.push('Focus on: src/ui/, src/components/, src/pages/, src/views/, src/hooks/');
      rules.push('Avoid modifying: API routes, server-side code, database schemas');
      break;
    case 'database':
      rules.push('You are working on DATABASE code.');
      rules.push('Focus on: src/db/, migrations, schema files');
      rules.push('CRITICAL: Only create migration files — never run them directly');
      break;
    case 'infrastructure':
      rules.push('You are working on INFRASTRUCTURE code.');
      rules.push('Focus on: .github/, Docker files, deployment configs, CI/CD');
      rules.push('Avoid modifying: Application source code');
      break;
    case 'security':
      rules.push('You are working on SECURITY code.');
      rules.push('Focus on: Authentication, authorization, middleware, security configs');
      rules.push('Be extra careful — security changes need thorough review');
      break;
    case 'testing':
      rules.push('You are working on TESTS.');
      rules.push('Focus on: Test files, test utilities, test configuration');
      rules.push('Avoid modifying: Production source code (unless fixing what you\'re testing)');
      break;
    case 'documentation':
      rules.push('You are working on DOCUMENTATION.');
      rules.push('Focus on: .md files, docs/, README, comments');
      rules.push('Avoid modifying: Source code');
      break;
    case 'billing':
      rules.push('You are working on BILLING code.');
      rules.push('Focus on: Payment integrations, subscription logic, invoicing');
      rules.push('Be extra careful — billing bugs can cause real money issues');
      break;
    default:
      rules.push('Domain not detected — exercise broad caution.');
      rules.push('Try to keep changes focused and minimal.');
  }

  return rules.join('\n');
}
