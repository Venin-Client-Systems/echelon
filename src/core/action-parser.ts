import { ActionSchema, type Action } from '../lib/types.js';
import { logger } from '../lib/logger.js';

/**
 * Extract JSON action blocks from agent response text.
 * Looks for ```json ... ``` fenced blocks containing action objects.
 */
export function parseActions(text: string): { actions: Action[]; errors: string[] } {
  const actions: Action[] = [];
  const errors: string[] = [];

  // Match ```json ... ``` blocks
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRegex.exec(text)) !== null) {
    const block = match[1].trim();
    try {
      const parsed = JSON.parse(block);

      // Could be a single action or an array
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        // Skip non-action JSON (no "action" field)
        if (!item || typeof item !== 'object' || !('action' in item)) continue;

        const result = ActionSchema.safeParse(item);
        if (result.success) {
          actions.push(result.data);
        } else {
          const errMsg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
          errors.push(`Invalid action "${item.action}": ${errMsg}`);
          logger.warn('Action validation failed', { action: item.action, error: errMsg });
        }
      }
    } catch (e) {
      // Not valid JSON — skip this block
      logger.debug('Skipped non-JSON block in agent response');
    }
  }

  return { actions, errors };
}

/**
 * Strip action blocks from text to get the narrative portion.
 */
export function stripActionBlocks(text: string): string {
  return text.replace(/```json\s*\n[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
