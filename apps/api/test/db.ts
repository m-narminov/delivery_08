import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { requireEnv } from '../src/env';

// У каждого прогона свои базы: test_<время запуска>_<случайное>_…. Параллельные прогоны (два
// терминала, ревьюер рядом с разработчиком) не трогают базы друг друга; брошенные базы
// прерванных прогонов находит global-setup.ts.
export const TEST_DATABASE_PREFIX = 'test_';

declare module 'vitest' {
  export interface ProvidedContext {
    testRunId: string;
  }
}

export function newTestRunId(): string {
  return `${Date.now()}_${randomUUID().slice(0, 8)}`;
}

// Шаблон с применёнными миграциями. Каждый тестовый файл получает свою копию:
// CREATE DATABASE … TEMPLATE копирует файлы БД целиком, это быстрее, чем гонять миграции.
export function templateDatabase(runId: string): string {
  return `${TEST_DATABASE_PREFIX}${runId}_template`;
}

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
  const runId = inject('testRunId');
  const name = `${TEST_DATABASE_PREFIX}${runId}_${randomUUID().replaceAll('-', '')}`;
  await withAdminClient((client) =>
    client.query(`CREATE DATABASE "${name}" TEMPLATE "${templateDatabase(runId)}"`),
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

// БД, к которой не подключиться: пул закрыт сразу, любой запрос падает — как при недоступной
// базе. Подключений не открывает, поэтому имя базы не важно.
export async function closedDatabase(): Promise<Database> {
  const { db, pool } = createDatabase(databaseUrl('unavailable'));
  await pool.end();
  return db;
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
