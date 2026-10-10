import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDatabase, type Database } from '../src/db/client';
import { requireEnv } from '../src/env';

// Шаблон с применёнными миграциями. Каждый тестовый файл получает свою копию:
// CREATE DATABASE … TEMPLATE копирует файлы БД целиком, это быстрее, чем гонять миграции.
export const TEMPLATE_DATABASE = 'foodster_template';
export const TEST_DATABASE_PREFIX = 'test_';

export function databaseUrl(name: string): string {
  const url = new URL(requireEnv('TEST_DATABASE_URL'));
  url.pathname = `/${name}`;
  return url.toString();
}

// Служебное подключение к основной тестовой БД — для CREATE/DROP DATABASE.
export async function withAdminClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: requireEnv('TEST_DATABASE_URL') });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export interface TestDatabase {
  db: Database;
  pool: pg.Pool;
  drop: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `${TEST_DATABASE_PREFIX}${randomUUID().replaceAll('-', '')}`;
  await withAdminClient((client) =>
    client.query(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE_DATABASE}"`),
  );
  const { db, pool } = createDatabase(databaseUrl(name));
  return {
    db,
    pool,
    drop: async () => {
      await pool.end();
      await withAdminClient((client) => client.query(`DROP DATABASE "${name}" WITH (FORCE)`));
    },
  };
}

// Код ошибки Postgres (SQLSTATE). Drizzle оборачивает ошибку драйвера, исходная лежит в cause.
export async function pgErrorCode(query: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error) {
    for (let current: unknown = error; current instanceof Error; current = current.cause) {
      if ('code' in current && typeof current.code === 'string') return current.code;
    }
    throw error;
  }
  return undefined;
}
