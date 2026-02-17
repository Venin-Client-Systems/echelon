import { Bot } from 'grammy';
import type { EchelonConfig } from '../lib/types.js';
import { logger } from '../lib/logger.js';
import { handleMessage, hasPendingQuestion, resolvePendingQuestion } from './handler.js';
import { escapeHtml, splitMessage } from './notifications.js';

let _bot: Bot | null = null;
let _chatId: string | null = null;

/** Message queue for serial processing */
interface QueueItem {
  text: string;
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}
const messageQueue: QueueItem[] = [];
let processing = false;

/**
 * Initialize and start the Telegram bot.
 * Auth: only processes messages from the configured chat ID.
 */
export function createTelegramBot(config: EchelonConfig): Bot {
  const tgConfig = config.telegram;
  if (!tgConfig) {
    throw new Error(
      'Telegram config not found. Set telegram.botToken and telegram.chatId in echelon.config.json',
    );
  }
  const botToken = process.env.ECHELON_TELEGRAM_BOT_TOKEN || tgConfig.botToken;
  const chatId = process.env.ECHELON_TELEGRAM_CHAT_ID || tgConfig.chatId;
  if (!botToken || !chatId) {
    throw new Error('Missing ECHELON_TELEGRAM_BOT_TOKEN or ECHELON_TELEGRAM_CHAT_ID');
  }
  _chatId = chatId;
  _bot = new Bot(botToken);

  // Auth middleware — only respond to the configured chat
  _bot.use(async (ctx, next) => {
    if (String(ctx.chat?.id) !== chatId) {
      logger.warn('Unauthorized Telegram message', { chatId: ctx.chat?.id });
      return; // Silently ignore
    }
    await next();
  });

  // Handle text messages
  _bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text) return;
    logger.debug('Telegram message received', { text: text.slice(0, 80) });

    // If there's a pending ask_user question, resolve it instead of starting new handleMessage
    if (hasPendingQuestion()) {
      const resolved = resolvePendingQuestion(text);
      if (resolved) {
        logger.debug('Resolved pending question with user reply');
        return; // The in-flight handleMessage will continue and send its own response
      }
    }

    try {
      const response = await enqueueMessage(text, config);
      await sendTelegramMessage(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Telegram handler error', { error: msg });
      await sendTelegramMessage(`Error: ${escapeHtml(msg)}`);
    }
  });

  // Handle /start command
  _bot.command('start', async (ctx) => {
    await ctx.reply(
      'Echelon CEO AI online. Send me directives and I\'ll run the cascade.\n\n' +
        'Commands:\n' +
        '/status — Current cascade state\n' +
        '/approve — Approve all pending actions\n' +
        '/reject <id> <reason> — Reject a pending action\n' +
        '/cost — Current cost breakdown\n' +
        '/quit — Shutdown gracefully',
    );
  });

  return _bot;
}

/** Get the initialized bot instance */
export function getBot(): Bot {
  if (!_bot) throw new Error('Telegram bot not initialized');
  return _bot;
}

/** Get the configured chat ID */
export function getChatId(): string {
  if (!_chatId) throw new Error('Telegram chat ID not configured');
  return _chatId;
}

/** Send a message to the configured chat */
export async function sendTelegramMessage(text: string): Promise<void> {
  const bot = getBot();
  const chatId = getChatId();
  const chunks = text.length > 4000 ? splitMessage(text, 4000) : [text];
  for (const chunk of chunks) {
    try {
      await bot.api.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
    } catch (err) {
      // Fallback: try without HTML parsing
      try {
        await bot.api.sendMessage(chatId, chunk.replace(/<[^>]+>/g, ''));
      } catch {
        logger.error('Failed to send Telegram message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/** Enqueue a message for serial processing */
function enqueueMessage(text: string, config: EchelonConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    messageQueue.push({ text, resolve, reject });
    if (!processing) processQueue(config);
  });
}

/** Process messages serially */
async function processQueue(config: EchelonConfig): Promise<void> {
  processing = true;
  while (messageQueue.length > 0) {
    const item = messageQueue.shift()!;
    try {
      const response = await handleMessage(item.text, config);
      item.resolve(response);
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
  processing = false;
}

/** Start the bot polling loop */
export async function startBot(config: EchelonConfig): Promise<void> {
  const bot = createTelegramBot(config);
  logger.info('Starting Telegram bot...');

  // Send online notification
  await sendTelegramMessage('Echelon CEO AI online. Ready for directives.');

  // Start polling
  bot.start({
    onStart: () => {
      logger.info('Telegram bot started');
    },
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down Telegram bot...');
    await sendTelegramMessage('Echelon going offline.');
    bot.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
