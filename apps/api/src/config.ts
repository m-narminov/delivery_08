import { z } from 'zod';

// Значение из .env.example: в production им подписывать сессии нельзя — оно публичное.
export const EXAMPLE_JWT_SECRET = 'dev-only-secret-change-me-0123456789abcdef';

export const logLevelSchema = z
  .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
  .default('info');

// Конфигурация проверяется один раз при старте: если чего-то не хватает, приложение
// падает сразу с понятным сообщением, а не через час на первом запросе (fail fast).
const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: logLevelSchema,
    DATABASE_URL: z.url(),
    // Секрет подписи сессий: короткий секрет подбирается перебором.
    JWT_SECRET: z.string().min(32),
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
    // Secure по умолчанию: забытая переменная не должна отправлять сессию по HTTP.
    // Выключается явно и только для локальной разработки по http://localhost.
    COOKIE_SECURE: z.stringbool().default(true),
    REDIS_URL: z.url().optional(),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && config.JWT_SECRET === EXAMPLE_JWT_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'must not be the example value from .env.example in production',
      });
    }
  });

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
