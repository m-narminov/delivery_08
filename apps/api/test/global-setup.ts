import { Redis } from 'ioredis';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrations';
import { requireEnv } from '../src/env';
import {
  databaseUrl,
  newTestRunId,
  templateDatabase,
  TEST_DATABASE_PREFIX,
  withAdminClient,
} from './db';

// Жив ли прогон, знает сам Postgres: прогон держит advisory-блокировку со своим id на отдельном
// соединении, пока идёт (и в режиме watch тоже). Процесс завершился — даже по Ctrl+C, когда
// Vitest не вызывает уборку, — соединение закрылось, блокировка снята. Базы прогона, чью
// блокировку удаётся взять, брошены: их удаляет следующий прогон. Блокировки привязаны к базе:
// защита работает, пока все прогоны подключаются к одной служебной базе (TEST_DATABASE_URL).
const RUN_NAME = /^test_(\d{13}_[0-9a-f]{8})_/;
const LOCK = 'pg_try_advisory_lock(hashtext($1))';

// Выполняется один раз перед всеми тестами: создаёт шаблон этого прогона со свежими миграциями.
// Возвращает уборку после всех тестов — удалить базы этого прогона.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Переменные проверяются до подключения: если их нет, ошибка должна сказать именно это,
  // а не «БД недоступна».
  const adminUrl = requireEnv('TEST_DATABASE_URL');
  await checkValkey(requireEnv('TEST_REDIS_URL'));
  const runId = newTestRunId();
  const template = templateDatabase(runId);
  // keepAlive: соединение простаивает весь прогон, а тихо оборванное промежуточным звеном оно
  // сняло бы блокировку незаметно для нас.
  const lock = new pg.Client({ connectionString: adminUrl, keepAlive: true });
  // Соединение потеряно посреди прогона (перезапуск тестового Postgres): без блокировки другие
  // прогоны сочтут наши базы брошенными — честнее остановиться с понятной причиной.
  lock.on('error', (error) => {
    console.error('Lost the test database connection that marks this run as alive. Restart tests.');
    console.error(error);
    process.exit(1);
  });
  try {
    try {
      await lock.connect();
      const { rows } = await lock.query<{ locked: boolean }>(`SELECT ${LOCK} AS locked`, [runId]);
      // Не взялась — ключ (hashtext — int4) совпал с чужим живым прогоном; повторный запуск
      // получит другой id.
      if (!rows[0]?.locked) throw new Error(`Run lock ${runId} is taken, restart tests`);
      await withAdminClient(async (client) => {
        await dropAbandoned(client);
        await client.query(`CREATE DATABASE "${template}"`);
      });
    } catch (error) {
      throw new Error('Test database is unavailable. Run "npm run test-db:setup" first.', {
        cause: error,
      });
    }

    const { db, pool } = createDatabase(databaseUrl(template));
    try {
      await runMigrations(db);
    } finally {
      // Пока к шаблону есть подключения, копировать его нельзя.
      await pool.end();
    }
  } catch (error) {
    // Открытое соединение не дало бы процессу завершиться (Vitest ждал бы 10 с).
    await lock.end().catch(() => undefined);
    throw error;
  }

  project.provide('testRunId', runId);
  const ownPrefix = `${TEST_DATABASE_PREFIX}${runId}_`;
  return async () => {
    try {
      await withAdminClient((client) =>
        dropDatabases(client, (name) => name.startsWith(ownPrefix)),
      );
    } finally {
      await lock.end();
    }
  };
}

// Брошенные базы: прогонов, которые уже не держат блокировку, и старой схемы имён
// (foodster_template, test_<uuid>) — её прогоны блокировок не брали. Блокировку чужого прогона
// берём на время проверки: два прогона, стартовавшие одновременно, не удаляют одно и то же.
async function dropAbandoned(client: pg.Client): Promise<void> {
  const names = await testDatabases(client);
  const runs = new Set(names.map((name) => RUN_NAME.exec(name)?.[1]));
  for (const run of runs) {
    if (run === undefined) {
      await dropDatabases(client, (name) => !RUN_NAME.test(name));
      continue;
    }
    const { rows } = await client.query<{ free: boolean }>(`SELECT ${LOCK} AS free`, [run]);
    if (!rows[0]?.free) continue;
    await dropDatabases(client, (name) => name.startsWith(`${TEST_DATABASE_PREFIX}${run}_`));
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [run]);
  }
}

async function testDatabases(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE starts_with(datname, $1) OR datname = 'foodster_template'",
    [TEST_DATABASE_PREFIX],
  );
  return rows.map((row) => row.datname);
}

async function dropDatabases(client: pg.Client, shouldDrop: (name: string) => boolean) {
  for (const name of await testDatabases(client)) {
    if (shouldDrop(name)) await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
}

// Тестам событий и кэша нужен Valkey. Проверяем сразу, чтобы не получить вместо понятной
// подсказки пачку таймаутов в отдельных тестах.
async function checkValkey(url: string): Promise<void> {
  // Одна попытка подключения, без повторов.
  const client = new Redis(url, { lazyConnect: true, retryStrategy: () => null });
  try {
    await client.connect();
    await client.ping();
  } catch (error) {
    throw new Error('Test Valkey is unavailable. Run "npm run test-db:setup" first.', {
      cause: error,
    });
  } finally {
    client.disconnect();
  }
}
