import { ActionSchema, type Action } from '../lib/types.js';
import { logger } from '../lib/logger.js';

/**
 * Extract and validate JSON action blocks from agent response text.
 *
 * Looks for ` ```json ... ``` ` fenced blocks containing action objects.
 * Handles edge cases like embedded triple backticks in JSON values
 * (e.g., code examples in issue bodies) by trying progressively longer
 * matches until JSON.parse succeeds.
 *
 * @category Core
 * @param text - Raw agent response text
 * @returns Object containing parsed actions and validation errors
 * @example
 * ```typescript
 * const response = `
 * Here's my plan:
 * \`\`\`json
 * {"action": "update_plan", "plan": "Implement auth"}
 * \`\`\`
 * `;
 *
 * const { actions, errors } = parseActions(response);
 * console.log(actions); // [{ action: 'update_plan', plan: '...' }]
 * ```
 */
export function parseActions(text: string): { actions: Action[]; errors: string[] } {
  const actions: Action[] = [];
  const errors: string[] = [];

  // Find all ```json openers
  const openerRegex = /```json\s*\n/gi;
  let openerMatch: RegExpExecArray | null;

  while ((openerMatch = openerRegex.exec(text)) !== null) {
    const contentStart = openerMatch.index + openerMatch[0].length;

    // Find all subsequent ``` closers and try each one
    const closerRegex = /```/g;
    closerRegex.lastIndex = contentStart;
    let closerMatch: RegExpExecArray | null;
    let parsed = false;

    while ((closerMatch = closerRegex.exec(text)) !== null) {
      const block = text.slice(contentStart, closerMatch.index).trim();
      try {
        const json = JSON.parse(block);

        // Could be a single action or an array
        const items = Array.isArray(json) ? json : [json];
        let hasAction = false;

        for (const item of items) {
          if (!item || typeof item !== 'object' || !('action' in item)) continue;
          hasAction = true;

          const result = ActionSchema.safeParse(item);
          if (result.success) {
            actions.push(result.data);
          } else {
            const errMsg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
            errors.push(`Invalid action "${item.action}": ${errMsg}`);
            logger.warn('Action validation failed', { action: item.action, error: errMsg });
          }
        }

        if (hasAction) {
          // Advance the opener regex past this block to avoid re-matching
          openerRegex.lastIndex = closerMatch.index + closerMatch[0].length;
          parsed = true;
          break;
        }

        // Valid JSON but not an action — skip this block
        openerRegex.lastIndex = closerMatch.index + closerMatch[0].length;
        parsed = true;
        break;
      } catch {
        // JSON.parse failed — try the next ``` closer
        continue;
      }
    }

    if (!parsed) {
      logger.debug('Skipped unclosed or unparseable JSON block in agent response');
    }
  }

  return { actions, errors };
}

/**
 * Remove action blocks from text to extract the narrative portion.
 *
 * Uses the same progressive matching as parseActions to correctly handle
 * embedded backticks in JSON strings. Cleans up excessive newlines.
 *
 * @param text - Raw agent response text with action blocks
 * @returns Text with all action blocks removed
 * @example
 * ```typescript
 * const response = `
 * I'll create issues:
 * \`\`\`json
 * {"action": "create_issues", "issues": [...]}
 * \`\`\`
 * This is my reasoning.
 * `;
 *
 * const narrative = stripActionBlocks(response);
 * console.log(narrative); // "I'll create issues:\n\nThis is my reasoning."
 * ```
 */
export function stripActionBlocks(text: string): string {
  let result = text;
  const openerRegex = /```json\s*\n/gi;
  let openerMatch: RegExpExecArray | null;

  // Collect ranges to remove (work backwards to preserve indices)
  const ranges: Array<[number, number]> = [];

  while ((openerMatch = openerRegex.exec(text)) !== null) {
    const contentStart = openerMatch.index + openerMatch[0].length;
    const closerRegex = /```/g;
    closerRegex.lastIndex = contentStart;
    let closerMatch: RegExpExecArray | null;

    while ((closerMatch = closerRegex.exec(text)) !== null) {
      const block = text.slice(contentStart, closerMatch.index).trim();
      try {
        const json = JSON.parse(block);
        const isActionBlock = (j: unknown): boolean => {
          if (Array.isArray(j)) return j.some(item => item && typeof item === 'object' && 'action' in item);
          return j != null && typeof j === 'object' && 'action' in j;
        };
        if (isActionBlock(json)) {
          ranges.push([openerMatch.index, closerMatch.index + closerMatch[0].length]);
          openerRegex.lastIndex = closerMatch.index + closerMatch[0].length;
        }
        break;
      } catch {
        continue;
      }
    }
  }

  // Remove ranges in reverse order
  for (let i = ranges.length - 1; i >= 0; i--) {
    result = result.slice(0, ranges[i][0]) + result.slice(ranges[i][1]);
  }

  return result.replace(/\n{3,}/g, '\n\n').trim();
}
