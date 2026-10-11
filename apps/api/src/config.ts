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
    // Без значения по умолчанию: окружение задаётся явно, иначе приложение не стартует.
    // Угадывать опасно в обе стороны: «development» на сервере отключил бы проверки ниже.
    // Локально значение приходит из .env.example, в тестах его ставит Vitest (test),
    // на Render — env group (production).
    NODE_ENV: z.enum(['development', 'test', 'production']),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: logLevelSchema,
    DATABASE_URL: z.url(),
    // Секрет подписи сессий: короткий секрет подбирается перебором.
    JWT_SECRET: z.string().min(32),
    // Не больше недели: поток live-обновлений закрывается таймером в момент истечения сессии,
    // а setTimeout в Node принимает не больше 2^31−1 мс (~596 ч) — при большем значении он
    // срабатывает сразу, и поток закрывался бы сразу после открытия.
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 7)
      .default(12),
    // Secure по умолчанию: забытая переменная не должна отправлять сессию по HTTP.
    // Выключается явно и только для локальной разработки по http://localhost.
    COOKIE_SECURE: z.stringbool().default(true),
    REDIS_URL: z.url().optional(),
    // Адреса прокси перед приложением (у Render — балансировщик): IP или CIDR через запятую.
    // Только от них Fastify принимает X-Forwarded-For и берёт оттуда IP клиента. Не задано —
    // заголовку не доверяем: его может подделать любой клиент, а IP нужен для логов и
    // ограничения частоты входа. Число прокси Fastify 5 не принимает: оно не проверяет,
    // что запрос пришёл именно от прокси.
    TRUST_PROXY: z.string().trim().min(1).optional(),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && config.JWT_SECRET === EXAMPLE_JWT_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'must not be the example value from .env.example in production',
      });
    }
    if (config.NODE_ENV === 'production' && !config.COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true in production: the session cookie must not be sent over plain HTTP',
      });
    }
  });

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Ошибка конфигурации — системная, для разработчика: всегда на английском.
  const result = configSchema.safeParse(env, { error: z.locales.en().localeError });
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
