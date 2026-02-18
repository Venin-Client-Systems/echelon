import { LAYER_LABELS } from '../lib/types.js';
import type { EchelonEvent } from '../lib/types.js';

/** Escape HTML for Telegram's HTML parse mode */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Split a long message into Telegram-safe chunks, preserving HTML tag boundaries */
export function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n', maxLen);

    // Ensure we don't split inside an HTML tag
    if (splitAt > 0) {
      // Check if we're inside a tag by counting < and > before splitAt
      const beforeSplit = remaining.slice(0, splitAt);
      const openTags = (beforeSplit.match(/</g) || []).length;
      const closeTags = (beforeSplit.match(/>/g) || []).length;

      // If unbalanced, move split point to before the last <
      if (openTags > closeTags) {
        const lastOpenTag = beforeSplit.lastIndexOf('<');
        if (lastOpenTag > 0) {
          splitAt = lastOpenTag;
        }
      }
    }

    if (splitAt <= 0) splitAt = maxLen; // Force-split at maxLen to prevent infinite loop
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, ''); // Strip leading newline from next chunk
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Format an EchelonEvent as a Telegram HTML message.
 * Returns null if the event doesn't need a notification.
 */
export function formatEventForTelegram(event: EchelonEvent): string | null {
  switch (event.type) {
    case 'agent_status': {
      const label = LAYER_LABELS[event.role] ?? event.role;
      if (event.status === 'thinking') {
        return `\u{1F4AD} <b>${label}</b> is thinking...`;
      }
      if (event.status === 'done') {
        return `\u{2705} <b>${label}</b> complete`;
      }
      if (event.status === 'error') {
        return `\u{274C} <b>${label}</b> encountered an error`;
      }
      return null; // Don't notify for idle, executing, waiting
    }
    case 'message': {
      const from = LAYER_LABELS[event.message.from] ?? event.message.from;
      const to = LAYER_LABELS[event.message.to] ?? event.message.to;
      const cost = `$${event.message.costUsd.toFixed(4)}`;
      const duration = `${(event.message.durationMs / 1000).toFixed(1)}s`;
      // Strip action blocks from the narrative
      const rawNarrative = event.message.content
        .replace(/```json[\s\S]*?```/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const narrative = escapeHtml(rawNarrative.slice(0, 300));
      return `\u{1F4E8} <b>${escapeHtml(from)} \u{2192} ${escapeHtml(to)}</b> (${cost}, ${duration})\n\n${narrative}${rawNarrative.length >= 300 ? '...' : ''}`;
    }
    case 'action_pending':
      return `\u{26A0}\u{FE0F} <b>Approval needed:</b> ${escapeHtml(event.approval.description)}\n\nReply <code>/approve ${event.approval.id}</code> or <code>/reject ${event.approval.id} reason</code>`;
    case 'action_executed':
      return `\u{2705} <b>Executed:</b> ${escapeHtml(event.action.action)} \u{2014} ${escapeHtml(event.result.slice(0, 200))}`;
    case 'action_rejected':
      return `\u{274C} <b>Rejected:</b> ${escapeHtml(event.approval.description)}\nReason: ${escapeHtml(event.reason)}`;
    case 'issue_created':
      return `\u{1F4CB} Issue #${event.issue.number}: ${escapeHtml(event.issue.title)}`;
    case 'cost_update':
      // Only notify on significant cost milestones
      return null;
    case 'error': {
      const label = LAYER_LABELS[event.role] ?? event.role;
      return `\u{274C} <b>${label} error:</b> ${escapeHtml(event.error.slice(0, 300))}`;
    }
    case 'cascade_complete':
      return `\u{2705} <b>Cascade complete!</b> Directive: "${escapeHtml(event.directive.slice(0, 100))}"`;
    case 'shutdown':
      return `\u{23F8}\u{FE0F} Session paused (${escapeHtml(event.reason)})`;
    // Cheenoski events
    case 'cheenoski_slot_fill':
      return `\u{1F527} Engineer slot filled: #${event.slot.issueNumber} ${escapeHtml(event.slot.issueTitle)} [${escapeHtml(event.slot.domain)}]`;
    case 'cheenoski_slot_done': {
      const status = event.slot.status === 'done' ? '\u{2705}' : '\u{274C}';
      return `${status} Engineer #${event.slot.issueNumber}: ${escapeHtml(event.slot.status)}${event.slot.error ? ` \u{2014} ${escapeHtml(event.slot.error.slice(0, 100))}` : ''}`;
    }
    case 'cheenoski_dashboard':
      return null; // Too frequent for Telegram
    case 'cheenoski_merge':
      if (!event.success) {
        return `\u{26A0}\u{FE0F} Merge failed for #${event.slot.issueNumber}: ${escapeHtml(event.error ?? 'unknown')}`;
      }
      return null;
    case 'cheenoski_pr_created':
      return `\u{1F517} PR #${event.prNumber} created for #${event.slot.issueNumber}: ${escapeHtml(event.prUrl)}`;
    case 'cheenoski_engine_switch':
      return `\u{1F504} Engine switch for #${event.slot.issueNumber}: ${event.from} \u{2192} ${event.to} (${escapeHtml(event.reason)})`;
    case 'cheenoski_complete':
      return `\u{1F3C1} <b>Cheenoski complete (${escapeHtml(event.label)})</b>\n` +
        `${event.stats.succeeded}/${event.stats.total} succeeded | ` +
        `${event.stats.failed} failed | ` +
        `${event.stats.prsCreated} PRs | ` +
        `${(event.stats.durationMs / 60_000).toFixed(1)}min`;
    default:
      return null;
  }
}
