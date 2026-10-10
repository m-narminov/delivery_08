import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { z } from 'zod';
import { logLevelSchema } from './config';

// Секреты не должны попасть в логи ни при каких условиях.
const REDACT_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

// Логгер создаётся при импорте, раньше loadConfig(), поэтому LOG_LEVEL проверяем здесь той же
// схемой: опечатка даёт понятное «Invalid configuration», а не внутреннюю ошибку pino.
function levelFromEnv(): string {
  const result = logLevelSchema.safeParse(process.env.LOG_LEVEL);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function createLogger(
  options: { level?: string; destination?: DestinationStream } = {},
): Logger {
  const config: LoggerOptions = {
    name: 'foodster-api',
    level: options.level ?? levelFromEnv(),
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
  if (options.destination) return pino(config, options.destination);

  // В production — JSON в stdout (его собирает Render). Локально в терминале — читаемый
  // цветной вывод через pino-pretty, он работает в отдельном потоке и не тормозит приложение.
  const pretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;
  return pino(
    pretty
      ? {
          ...config,
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : config,
  );
}

export const logger = createLogger();
