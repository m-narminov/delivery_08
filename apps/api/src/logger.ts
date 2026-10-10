import { DrizzleQueryError } from 'drizzle-orm';
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

// Ошибка запроса Drizzle хранит значения параметров и в поле params, и в тексте сообщения
// (а значит, и в stack): «Failed query: … params: …». Там бывают хеши паролей (seed) и данные
// клиентов, а redact по путям текст сообщения не чистит. В лог идёт копия без значений:
// текст SQL с плейсхолдерами $1, $2 и причина (ошибка Postgres) остаются.
function withoutQueryParams(error: Error): Error {
  if (error instanceof DrizzleQueryError) {
    const safe = new Error(`Failed query: ${error.query}`, { cause: error.cause });
    safe.name = 'DrizzleQueryError';
    if (error.stack) safe.stack = error.stack.replace(error.message, safe.message);
    return safe;
  }
  // Ошибка Drizzle может оказаться и причиной другой ошибки: pino выводит сообщения всей цепочки.
  if (error.cause instanceof Error) {
    const cause = withoutQueryParams(error.cause);
    if (cause !== error.cause) {
      const copy = Object.create(Object.getPrototypeOf(error) as object) as Error;
      Object.defineProperties(copy, Object.getOwnPropertyDescriptors(error));
      copy.cause = cause;
      return copy;
    }
  }
  return error;
}

function serializeError(value: unknown): unknown {
  return value instanceof Error ? pino.stdSerializers.err(withoutQueryParams(value)) : value;
}

// Логгер создаётся при импорте, раньше loadConfig(), поэтому LOG_LEVEL проверяем здесь той же
// схемой: опечатка даёт понятное «Invalid configuration», а не внутреннюю ошибку pino.
function levelFromEnv(): string {
  const result = logLevelSchema.safeParse(process.env.LOG_LEVEL, {
    error: z.locales.en().localeError,
  });
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
    serializers: { err: serializeError },
  };
  if (options.destination) return pino(config, options.destination);

  // В production — JSON в stdout (его собирает Render). Локально в терминале — читаемый
  // цветной вывод через pino-pretty, он работает в отдельном потоке и не тормозит приложение.
  // Без NODE_ENV — JSON: config.ts всё равно не даст приложению запуститься.
  const environment = process.env.NODE_ENV;
  const pretty = environment !== undefined && environment !== 'production' && process.stdout.isTTY;
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
