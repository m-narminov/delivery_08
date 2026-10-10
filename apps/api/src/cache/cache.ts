import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { z } from 'zod';

// Кэш справочников по схеме cache-aside: прочитать из кэша, при промахе — загрузить из БД
// и положить в кэш. Заказы и счётчики активных доставок сюда не попадают: они должны быть
// свежими (конфликты версий, лимит курьера).
export interface Cache {
  getOrLoad<T>(key: string, schema: z.ZodType<T>, load: () => Promise<T>): Promise<T>;
}

// Без Valkey: всегда из БД.
export const noCache: Cache = {
  getOrLoad: (_key, _schema, load) => load(),
};

// Ключи с версией формата: если формат данных изменится, достаточно поднять версию —
// старые значения не будут прочитаны и истекут по TTL.
export const CACHE_KEY_PREFIX = 'foodster:v1:';

// Справочники в API не меняются, поэтому явной инвалидации нет: устаревание ограничено TTL
// (например, после пересоздания БД и нового seed). Появится редактирование — удалять ключ
// при изменении.
export const REFERENCE_CACHE_TTL_SECONDS = 300;

export function createValkeyCache(options: {
  client: Redis;
  logger: FastifyBaseLogger;
  prefix?: string;
  ttlSeconds?: number;
}): Cache {
  const {
    client,
    logger,
    prefix = CACHE_KEY_PREFIX,
    ttlSeconds = REFERENCE_CACHE_TTL_SECONDS,
  } = options;

  return {
    async getOrLoad(key, schema, load) {
      // Нет соединения — сразу в БД и без записи в лог на каждый запрос: ошибку подключения
      // клиент уже записал (src/valkey/client.ts).
      if (client.status !== 'ready') return load();

      const fullKey = `${prefix}${key}`;
      // Любая проблема с кэшем — промах: данные всё равно есть в БД.
      try {
        const cached = await client.get(fullKey);
        if (cached !== null) {
          // Проверка схемой: в кэше мог остаться формат от предыдущей версии приложения.
          const result = schema.safeParse(JSON.parse(cached));
          if (result.success) return result.data;
          logger.warn({ key: fullKey }, 'Cached value has unexpected shape, reloading');
        }
      } catch (error) {
        logger.warn({ err: error, key: fullKey }, 'Cache read failed, loading from database');
      }

      const value = await load();
      try {
        await client.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds);
      } catch (error) {
        logger.warn({ err: error, key: fullKey }, 'Cache write failed');
      }
      return value;
    },
  };
}
