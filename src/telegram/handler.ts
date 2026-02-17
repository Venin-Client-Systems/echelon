import Anthropic from '@anthropic-ai/sdk';
import type { EchelonConfig } from '../lib/types.js';
import { ceoTools } from './tools.js';
import { executeCeoTool } from './tool-handlers.js';
import { loadHistory, saveHistory } from './history.js';
import type { StoredMessage } from './history.js';
import { sendTelegramMessage } from './bot.js';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  _client = new Anthropic({ apiKey });
  return _client;
}

const MAX_TOOL_ITERATIONS = 10;

/** Pending question resolver — set by bot.ts when ask_user fires */
let pendingQuestionResolve: ((answer: string) => void) | null = null;

/** Called by bot.ts when a user message arrives while a question is pending */
export function resolvePendingQuestion(answer: string): boolean {
  if (pendingQuestionResolve) {
    pendingQuestionResolve(answer);
    pendingQuestionResolve = null;
    return true;
  }
  return false;
}

/** Check if there's a pending question waiting for user input */
export function hasPendingQuestion(): boolean {
  return pendingQuestionResolve !== null;
}

/** Wait for user to answer a question sent via Telegram */
function waitForUserAnswer(): Promise<string> {
  return new Promise((resolve) => {
    pendingQuestionResolve = resolve;
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

/**
 * Handle an incoming Telegram message from the vibe coder.
 * Routes through Claude API with CEO tools.
 */
export async function handleMessage(text: string, config: EchelonConfig): Promise<string> {
  const client = getClient();
  const systemPrompt = buildSystemPrompt(config);
  const history = loadHistory();
  const messages: StoredMessage[] = [...history, { role: 'user', content: text }];

  let response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    tools: ceoTools,
    messages: messages as Anthropic.Messages.MessageParam[],
  });

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

    response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: ceoTools,
      messages: messages as Anthropic.Messages.MessageParam[],
    });
  }

  for (const block of response.content) {
    if (block.type === 'text') finalText += block.text;
  }

  messages.push({ role: 'assistant', content: response.content });
  saveHistory(messages);

  return finalText;
}
