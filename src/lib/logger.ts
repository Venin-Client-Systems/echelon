type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevel = LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) || 'info'] ?? LOG_LEVELS.info;
let quiet = false;

function formatMessage(level: LogLevel, msg: string, data?: Record<string, unknown>): string {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `[${ts}] ${level.toUpperCase().padEnd(5)}`;
  if (data) return `${prefix} ${msg} ${JSON.stringify(data)}`;
  return `${prefix} ${msg}`;
}

function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  if (quiet || LOG_LEVELS[level] < minLevel) return;
  const output = formatMessage(level, msg, data);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data),
  setLevel: (level: LogLevel) => { minLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info; },
  setQuiet: (q: boolean) => { quiet = q; },
};
