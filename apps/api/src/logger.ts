import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

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

export function createLogger(
  options: { level?: string; destination?: DestinationStream } = {},
): Logger {
  const config: LoggerOptions = {
    name: 'foodster-api',
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
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
