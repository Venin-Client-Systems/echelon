import Anthropic from '@anthropic-ai/sdk';
import { nanoid } from 'nanoid';
import type { EchelonConfig } from '../lib/types.js';
import { ceoTools } from './tools.js';
import { executeCeoTool } from './tool-handlers.js';
import { loadHistory, saveHistory } from './history.js';
import type { StoredMessage } from './history.js';
import { sendTelegramMessage } from './bot.js';

/** Sanitize error messages to prevent credential leakage */
function sanitizeError(msg: string): string {
  return msg
    .replace(/ANTHROPIC_API_KEY[=:]\s*[^\s]+/gi, 'ANTHROPIC_API_KEY=[REDACTED]')
    .replace(/sk-ant-[a-zA-Z0-9-_]+/gi, '[REDACTED]')
    .replace(/ghp_[a-zA-Z0-9]{36,}/gi, '[REDACTED]')
    .replace(/gho_[a-zA-Z0-9]{36,}/gi, '[REDACTED]')
    .replace(/github_pat_[a-zA-Z0-9_]+/gi, '[REDACTED]')
    .replace(/[Tt]oken[=:]\s*[a-zA-Z0-9_-]{20,}/g, 'Token=[REDACTED]')
    .replace(/[Aa]pi[Kk]ey[=:]\s*[a-zA-Z0-9_-]{20,}/g, 'ApiKey=[REDACTED]')
    .replace(/[Aa]uthorization:\s*Bearer\s+[a-zA-Z0-9_-]+/g, 'Authorization: Bearer [REDACTED]');
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  _client = new Anthropic({ apiKey });
  return _client;
}

const MAX_TOOL_ITERATIONS = 10;
const QUESTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Pending question resolvers keyed by unique question ID */
const pendingQuestions = new Map<string, (answer: string) => void>();

/** Called by bot.ts when a user message arrives while a question is pending.
 *  Resolves the most recently added pending question. */
export function resolvePendingQuestion(answer: string): boolean {
  // Resolve the most recent pending question (last entry in the map)
  const keys = Array.from(pendingQuestions.keys());
  if (keys.length === 0) return false;
  const mostRecentKey = keys[keys.length - 1];
  const resolver = pendingQuestions.get(mostRecentKey);
  if (resolver) {
    pendingQuestions.delete(mostRecentKey);
    resolver(answer);
    return true;
  }
  return false;
}

/** Check if there's a pending question waiting for user input */
export function hasPendingQuestion(): boolean {
  return pendingQuestions.size > 0;
}

/** Wait for user to answer a question sent via Telegram, with a 5-minute timeout */
function waitForUserAnswer(): Promise<string> {
  return new Promise((resolve) => {
    const questionId = nanoid();
    const timer = setTimeout(() => {
      if (pendingQuestions.has(questionId)) {
        pendingQuestions.delete(questionId);
        resolve('No response received (timed out after 5 minutes).');
      }
    }, QUESTION_TIMEOUT_MS);

    pendingQuestions.set(questionId, (answer: string) => {
      clearTimeout(timer);
      resolve(answer);
    });
  });
}

function buildSystemPrompt(config: EchelonConfig): string {
  return `You are the CEO AI of Echelon — a hierarchical multi-agent engineering organization.

You are talking to a vibe coder via Telegram. They give you directives, and you use your tools to run engineering cascades.

## Your Organization
- **2IC (Second in Command)**: Strategic planning layer
- **Eng Lead**: Technical architecture and task breakdown
- **Team Lead**: GitHub issue creation and engineer coordination
- **Engineers (Cheenoski)**: Parallel AI code agents in isolated worktrees

## Your Capabilities
- Start cascades (engineering directives flow through your org)
- Approve/reject pending actions (issue creation, code execution)
- Monitor progress and report status
- Ask the human for clarification when needed

## Project Context
- Repository: ${config.project.repo}
- Base branch: ${config.project.baseBranch}
- Budget: $${config.maxTotalBudgetUsd}
- Approval mode: ${config.approvalMode}

## Communication Style
- Be concise but informative
- Use clear status updates
- Proactively report issues and ask for decisions
- Don't be overly formal — this is a chat interface`;
}

const API_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_HISTORY_TOKENS = 50_000; // Rough token limit for history

/** Estimate tokens (rough: 4 chars per token) */
function estimateTokens(messages: StoredMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else {
      chars += JSON.stringify(msg.content).length;
    }
  }
  return Math.ceil(chars / 4);
}

/** Trim history to stay under token limit while preserving valid API sequences.
 *  The Anthropic API requires messages to alternate user/assistant and never
 *  start with an assistant message or leave orphaned tool_result messages. */
function trimHistory(messages: StoredMessage[]): StoredMessage[] {
  while (messages.length > 0 && estimateTokens(messages) > MAX_HISTORY_TOKENS) {
    // Remove oldest message pair (user + assistant)
    if (messages[0].role === 'user' && messages.length > 1) {
      messages = messages.slice(2);
    } else {
      messages = messages.slice(1);
    }
  }

  // Ensure the sequence starts with a 'user' message (API requirement).
  // After trimming, we may have an orphaned 'assistant' or tool_result first.
  while (messages.length > 0 && messages[0].role !== 'user') {
    messages = messages.slice(1);
  }

  // Ensure the sequence doesn't start with a tool_result 'user' message
  // (which would be orphaned without its preceding assistant tool_use).
  while (messages.length > 0 && messages[0].role === 'user' && Array.isArray(messages[0].content)) {
    messages = messages.slice(1);
    // Skip any following assistant message too to maintain alternation
    if (messages.length > 0 && messages[0].role === 'assistant') {
      messages = messages.slice(1);
    }
  }

  return messages;
}

/**
 * Handle an incoming Telegram message from the vibe coder.
 * Routes through Claude API with CEO tools.
 */
export async function handleMessage(text: string, config: EchelonConfig): Promise<string> {
  const client = getClient();
  const systemPrompt = buildSystemPrompt(config);
  let history = loadHistory();

  // Trim history to prevent token blowout
  history = trimHistory(history);

  const messages: StoredMessage[] = [...history, { role: 'user', content: text }];

  let response: Anthropic.Messages.Message;
  try {
    response = await Promise.race([
      client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        tools: ceoTools,
        messages: messages as Anthropic.Messages.MessageParam[],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Claude API timeout')), API_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Claude API error: ${sanitizeError(msg)}`);
  }

  let finalText = '';
  let toolIterations = 0;

  while (response.stop_reason === 'tool_use' && toolIterations < MAX_TOOL_ITERATIONS) {
    toolIterations++;
    const toolBlocks = response.content.filter(b => b.type === 'tool_use');
    const textBlocks = response.content.filter(b => b.type === 'text');

    for (const b of textBlocks) {
      if (b.type === 'text') finalText += b.text;
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of toolBlocks) {
      if (block.type === 'tool_use') {
        const result = await executeCeoTool(
          block.name,
          block.input as Record<string, unknown>,
          config,
        );

        // Special handling for ask_user — pause until user replies
        if (result.startsWith('QUESTION_FOR_USER:')) {
          const question = result.replace('QUESTION_FOR_USER: ', '');
          await sendTelegramMessage(`<b>Question:</b> ${question}`);

          // Block until user's next message resolves the promise
          const answer = await waitForUserAnswer();
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `User replied: ${answer}`,
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content:
              result.length > 2000
                ? result.slice(0, 2000) + '\n[...truncated]'
                : result,
          });
        }
      }
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    try {
      response = await Promise.race([
        client.messages.create({
          model: 'claude-opus-4-6',
          max_tokens: 4096,
          system: systemPrompt,
          tools: ceoTools,
          messages: messages as Anthropic.Messages.MessageParam[],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Claude API timeout')), API_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Claude API error: ${sanitizeError(msg)}`);
    }
  }

  for (const block of response.content) {
    if (block.type === 'text') finalText += block.text;
  }

  messages.push({ role: 'assistant', content: response.content });
  saveHistory(messages);

  return finalText;
}
