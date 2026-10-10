import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createValkeyCache, REFERENCE_CACHE_TTL_SECONDS } from '../../src/cache/cache';
import { logger } from '../../src/logger';
import { UNREACHABLE_VALKEY_URL, uniqueName, valkeyClients } from '../valkey';

const namesSchema = z.array(z.object({ id: z.number(), name: z.string() }));

// Загрузчик-счётчик: сколько раз пришлось идти «в БД».
function loader(value: { id: number; name: string }[]) {
  let calls = 0;
  return {
    load: () => {
      calls += 1;
      return Promise.resolve(value);
    },
    calls: () => calls,
  };
}

describe('кэш справочников в Valkey', () => {
  const clients = valkeyClients();
  afterAll(() => clients.disconnect());

  it('первый раз загружает из БД, второй — из кэша; у ключа есть TTL', async () => {
    const client = await clients.ready('commands');
    const prefix = uniqueName('prefix');
    const cache = createValkeyCache({ client, logger, prefix });
    const source = loader([{ id: 1, name: 'Пицца' }]);

    expect(await cache.getOrLoad('restaurants', namesSchema, source.load)).toEqual([
      { id: 1, name: 'Пицца' },
    ]);
    expect(await cache.getOrLoad('restaurants', namesSchema, source.load)).toEqual([
      { id: 1, name: 'Пицца' },
    ]);
    expect(source.calls()).toBe(1);

    const ttl = await client.ttl(`${prefix}restaurants`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(REFERENCE_CACHE_TTL_SECONDS);
  });

  it('значение не того формата (от старой версии) — загружается заново и перезаписывается', async () => {
    const client = await clients.ready('commands');
    const prefix = uniqueName('prefix');
    await client.set(`${prefix}restaurants`, JSON.stringify([{ id: 'old-format' }]));
    const cache = createValkeyCache({ client, logger, prefix });
    const source = loader([{ id: 1, name: 'Пицца' }]);

    expect(await cache.getOrLoad('restaurants', namesSchema, source.load)).toEqual([
      { id: 1, name: 'Пицца' },
    ]);
    expect(source.calls()).toBe(1);
    expect(JSON.parse((await client.get(`${prefix}restaurants`)) ?? 'null')).toEqual([
      { id: 1, name: 'Пицца' },
    ]);
  });

  it('Valkey недоступен — данные из БД, без ошибки', async () => {
    const unreachable = valkeyClients(UNREACHABLE_VALKEY_URL);
    try {
      const cache = createValkeyCache({
        client: unreachable.create('commands'),
        logger,
        prefix: uniqueName('prefix'),
      });
      const source = loader([{ id: 1, name: 'Пицца' }]);
      await cache.getOrLoad('restaurants', namesSchema, source.load);
      await cache.getOrLoad('restaurants', namesSchema, source.load);
      expect(source.calls()).toBe(2);
    } finally {
      unreachable.disconnect();
    }
  });
});
