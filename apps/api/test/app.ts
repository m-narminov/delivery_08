import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import type { Config } from '../src/config';
import type { Database } from '../src/db/client';
import { operators } from '../src/db/schema';
import { SESSION_COOKIE } from '../src/http/session';
import { createTestDatabase } from './db';

export const TEST_PASSWORD = 'test-password';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 0,
    DATABASE_URL: 'postgres://unused',
    JWT_SECRET: 'test-secret-'.padEnd(32, 'x'),
    SESSION_TTL_HOURS: 12,
    REDIS_URL: undefined,
    ...overrides,
  };
}

export type TestApp = Awaited<ReturnType<typeof buildApp>>;

// Приложение на отдельной тестовой БД. close() закрывает приложение и удаляет БД.
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
