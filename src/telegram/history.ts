import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';

const ECHELON_HOME = join(homedir(), '.echelon');
const HISTORY_PATH = join(ECHELON_HOME, 'chat-history.json');
const MAX_USER_TURNS = 15;

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
    return JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
  } catch {
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
  const tmp = HISTORY_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(trimmed, null, 2), 'utf-8');
  renameSync(tmp, HISTORY_PATH);
}

/** Clear conversation history */
export function clearHistory(): void {
  ensureDir();
  writeFileSync(HISTORY_PATH, '[]', 'utf-8');
}
