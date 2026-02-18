import { Bot } from 'grammy';
import type { EchelonConfig } from '../lib/types.js';
import { logger } from '../lib/logger.js';
import { handleMessage, hasPendingQuestion, resolvePendingQuestion } from './handler.js';
import { escapeHtml, splitMessage, formatEventForTelegram } from './notifications.js';
import { executeCeoTool, onOrchestratorCreated } from './tool-handlers.js';
import { HealthServer } from './health.js';

let _bot: Bot | null = null;
let _chatId: string | null = null;
let _healthServer: HealthServer | null = null;

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
      'Telegram config not found. Set telegram.token in echelon.config.json',
    );
  }
  const botToken = process.env.ECHELON_TELEGRAM_BOT_TOKEN || tgConfig.token;
  const chatId = process.env.ECHELON_TELEGRAM_CHAT_ID || '';
  if (!botToken) {
    throw new Error('Missing telegram.token or ECHELON_TELEGRAM_BOT_TOKEN');
  }
  _chatId = chatId;
  _bot = new Bot(botToken);

  // Auth middleware — verify chat ID and user ID
  const allowedUserIds: string[] = process.env.ECHELON_TELEGRAM_ALLOWED_USERS?.split(',').map(s => s.trim())
    ?? tgConfig.allowedUserIds.map(String)
    ?? [];

  _bot.use(async (ctx, next) => {
    if (String(ctx.chat?.id) !== chatId) {
      logger.warn('Unauthorized Telegram message — wrong chat', { chatId: ctx.chat?.id });
      return; // Silently ignore
    }

    // In group chats, ctx.chat.id is the group ID, not the user ID.
    // Check ctx.from.id against allowed users if configured.
    const fromUserId = ctx.from?.id ? String(ctx.from.id) : undefined;
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

    if (isGroup) {
      logger.warn('Message received in group chat', {
        chatId: ctx.chat?.id,
        fromUserId,
        chatType: ctx.chat?.type,
      });
    }

    if (allowedUserIds.length > 0 && fromUserId && !allowedUserIds.includes(fromUserId)) {
      logger.warn('Unauthorized Telegram user', { fromUserId, chatId: ctx.chat?.id });
      return; // Silently ignore
    }

    await next();
  });

  // Handle text messages
  _bot.on('message:text', async (ctx) => {
    try {
      const text = ctx.message.text.trim();
      if (!text) return;
      logger.debug('Telegram message received', { text: text.slice(0, 80) });

      // Record activity for health check
      _healthServer?.recordActivity();

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
        _healthServer?.recordError();
        await sendTelegramMessage(`Error: ${escapeHtml(msg)}`);
      }
    } catch (err) {
      logger.error('Fatal message handler error', {
        error: err instanceof Error ? err.message : String(err),
      });
      _healthServer?.recordError();
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

  // Handle /status command
  _bot.command('status', async (ctx) => {
    try {
      const result = await executeCeoTool('cascade_status', {}, config);
      await ctx.reply(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Status command error', { error: msg });
      await ctx.reply(`Error: ${msg}`).catch(() => {});
    }
  });

  // Handle /approve command
  _bot.command('approve', async (ctx) => {
    try {
      const result = await executeCeoTool('approve_action', { approval_id: 'all' }, config);
      await ctx.reply(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Approve command error', { error: msg });
      await ctx.reply(`Error: ${msg}`).catch(() => {});
    }
  });

  // Handle /reject command
  _bot.command('reject', async (ctx) => {
    try {
      const args = ctx.match?.toString().trim() ?? '';
      const spaceIdx = args.indexOf(' ');
      const approvalId = spaceIdx > 0 ? args.slice(0, spaceIdx) : args;
      const reason = spaceIdx > 0 ? args.slice(spaceIdx + 1).trim() : '';
      if (!approvalId) {
        await ctx.reply('Usage: /reject <id> <reason>');
        return;
      }
      const result = await executeCeoTool('reject_action', { approval_id: approvalId, reason: reason || 'No reason given' }, config);
      await ctx.reply(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Reject command error', { error: msg });
      await ctx.reply(`Error: ${msg}`).catch(() => {});
    }
  });

  // Handle /cost command
  _bot.command('cost', async (ctx) => {
    try {
      const result = await executeCeoTool('get_cost', {}, config);
      await ctx.reply(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Cost command error', { error: msg });
      await ctx.reply(`Error: ${msg}`).catch(() => {});
    }
  });

  // Handle /quit command
  _bot.command('quit', async (ctx) => {
    try {
      await executeCeoTool('pause_cascade', {}, config);
      await ctx.reply('Shutting down...');
      _bot?.stop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Quit command error', { error: msg });
      await ctx.reply(`Error: ${msg}`).catch(() => {});
    }
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
  if (!config.telegram) {
    throw new Error('Telegram is not configured. Add a telegram section to echelon.config.json');
  }

  const bot = createTelegramBot(config);
  logger.info('Starting Telegram bot...');

  // Start health server if configured
  if (config.telegram.health?.enabled) {
    _healthServer = new HealthServer(config.telegram.health);
    try {
      await _healthServer.start();
    } catch (err) {
      logger.error('Failed to start health server', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // Send online notification
  await sendTelegramMessage('Echelon CEO AI online. Ready for directives.');

  // Subscribe to orchestrator events for real-time notifications
  onOrchestratorCreated((orch) => {
    orch.bus.onEchelon((event) => {
      const message = formatEventForTelegram(event);
      if (message !== null) {
        sendTelegramMessage(message).catch((err) => {
          logger.error('Failed to send event notification', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    });
  });

  // Start polling with error handling
  bot.start({
    onStart: () => {
      logger.info('Telegram bot started');
    },
  }).catch((err) => {
    logger.error('Bot start error', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  });

  // Handle unhandled errors
  bot.catch((err) => {
    logger.error('Bot unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    try {
      logger.info('Shutting down Telegram bot...');
      await sendTelegramMessage('Echelon going offline.').catch(() => {});

      // Stop health server if running
      if (_healthServer) {
        await _healthServer.stop().catch((err) => {
          logger.error('Failed to stop health server', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      bot.stop();
    } catch (err) {
      logger.error('Shutdown error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
