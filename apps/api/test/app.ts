import { randomUUID } from 'node:crypto';
import { problemSchema, type Problem } from '@foodster/shared';
import { buildApp } from '../src/app';
import { createValkeyCache } from '../src/cache/cache';
import { hashPassword } from '../src/auth/password';
import type { Config } from '../src/config';
import type { Database } from '../src/db/client';
import { operators } from '../src/db/schema';
import { SESSION_COOKIE } from '../src/http/session';
import { logger } from '../src/logger';
import { createValkeyOrderEventBus } from '../src/realtime/order-event-bus';
import { createTestDatabase } from './db';
import { uniqueName, untilReady, valkeyClients } from './valkey';

export const TEST_PASSWORD = 'test-password';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 0,
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unused',
    JWT_SECRET: 'test-secret-'.padEnd(32, 'x'),
    SESSION_TTL_HOURS: 12,
    COOKIE_SECURE: false,
    REDIS_URL: undefined,
    TRUST_PROXY: undefined,
    ...overrides,
  };
}

export type TestApp = Awaited<ReturnType<typeof buildApp>>;

// Приложение на отдельной тестовой БД. close() закрывает приложение и удаляет БД.
// По умолчанию без Valkey (события внутри процесса, без кэша), как при пустом REDIS_URL.
export async function createTestApp() {
  const testDb = await createTestDatabase();
  const app = await buildApp({ config: testConfig(), db: testDb.db });
  return {
    app,
    db: testDb.db,
    close: async () => {
      await app.close();
      await testDb.drop();
    },
  };
}

// Valkey для приложения, как в server.ts, но со своим каналом и префиксом ключей.
// Несколько приложений с одним каналом — это несколько инстансов одного сервиса.
// В отличие от сервера, тест дожидается соединения и подписки: иначе первые команды ушли бы
// мимо Valkey (кэш — промах, событие — только локально), и проверять было бы нечего.
export async function testValkeyDependencies(channel = uniqueName('channel')) {
  const clients = valkeyClients();
  const commands = clients.create('commands');
  const subscriber = clients.create('subscriber');
  const orderEvents = createValkeyOrderEventBus({
    publisher: commands,
    subscriber,
    logger,
    channel,
  });
  const cache = createValkeyCache({ client: commands, logger, prefix: uniqueName('prefix') });
  await Promise.all([untilReady(commands), orderEvents.subscribed]);
  return {
    channel,
    orderEvents,
    cache,
    commands,
    subscriber,
    disconnect: () => clients.disconnect(),
  };
}

export async function insertOperator(
  db: Database,
  overrides: Partial<typeof operators.$inferInsert> = {},
) {
  const [row] = await db
    .insert(operators)
    .values({
      name: 'Тестовый оператор',
      email: `operator-${randomUUID()}@test.local`,
      passwordHash: await hashPassword(TEST_PASSWORD),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('operator was not inserted');
  return row;
}

// Тело ошибки, проверенное общей схемой из shared: если ответ разойдётся с контрактом,
// тест упадёт здесь, а не на фронте.
export function problemBody(response: { json: () => unknown }): Problem {
  return problemSchema.parse(response.json());
}

// Входит под оператором и возвращает значение cookie сессии для следующих запросов.
export async function loginAs(app: TestApp, operatorId: number): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { operatorId, password: TEST_PASSWORD },
  });
  const session = response.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
  if (response.statusCode !== 200 || !session) {
    throw new Error(`login failed with status ${response.statusCode}`);
  }
  return session.value;
}
