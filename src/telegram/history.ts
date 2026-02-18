import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';

const ECHELON_HOME = join(homedir(), '.echelon');
const HISTORY_PATH = join(ECHELON_HOME, 'chat-history.json');
const MAX_USER_TURNS = 15;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit

/** Broad enough to hold Anthropic SDK ContentBlock[] and ToolResultBlockParam[] */
export type MessageContent = string | unknown[];

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: MessageContent;
}

function ensureDir(): void {
  if (!existsSync(ECHELON_HOME)) {
    mkdirSync(ECHELON_HOME, { recursive: true });
  }
}

/** Load conversation history from disk */
export function loadHistory(): StoredMessage[] {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    // Check file size before loading
    const stats = statSync(HISTORY_PATH);
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      // File too large, reset it
      writeFileSync(HISTORY_PATH, '[]', 'utf-8');
      return [];
    }
    const content = readFileSync(HISTORY_PATH, 'utf-8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    // Corrupted file, reset it
    try {
      unlinkSync(HISTORY_PATH);
    } catch { /* ignore */ }
    return [];
  }
}

/** Save conversation history to disk, trimmed to MAX_USER_TURNS */
export function saveHistory(messages: StoredMessage[]): void {
  ensureDir();
  // Trim by counting user turns from the end
  let userCount = 0;
  let cutoff = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') userCount++;
    if (userCount > MAX_USER_TURNS) {
      cutoff = i + 1;
      break;
    }
  }
  // Ensure we start with a user message
  while (cutoff < messages.length && messages[cutoff].role !== 'user') {
    cutoff++;
  }
  const trimmed = messages.slice(cutoff);

  try {
    const tmp = HISTORY_PATH + '.tmp';
    writeFileSync(tmp, JSON.stringify(trimmed, null, 2), 'utf-8');
    renameSync(tmp, HISTORY_PATH);
  } catch (err) {
    // If atomic write fails, try direct write as fallback
    try {
      writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2), 'utf-8');
    } catch { /* ignore - we did our best */ }
  }
}

/** Clear conversation history */
export function clearHistory(): void {
  ensureDir();
  writeFileSync(HISTORY_PATH, '[]', 'utf-8');
}
