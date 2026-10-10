import { createDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrations';
import { databaseUrl, TEMPLATE_DATABASE, TEST_DATABASE_PREFIX, withAdminClient } from './db';

// Выполняется один раз перед всеми тестами: пересоздаёт шаблонную БД со свежими миграциями.
export default async function setup(): Promise<void> {
  try {
    await withAdminClient(async (client) => {
      // Остатки прошлых прогонов, если тесты были прерваны.
      const { rows } = await client.query<{ datname: string }>(
        'SELECT datname FROM pg_database WHERE starts_with(datname, $1)',
        [TEST_DATABASE_PREFIX],
      );
      for (const { datname } of rows) {
        await client.query(`DROP DATABASE "${datname}" WITH (FORCE)`);
      }
      await client.query(`DROP DATABASE IF EXISTS "${TEMPLATE_DATABASE}" WITH (FORCE)`);
      await client.query(`CREATE DATABASE "${TEMPLATE_DATABASE}"`);
    });
  } catch (error) {
    throw new Error('Test database is unavailable. Run "npm run test-db:setup" first.', {
      cause: error,
    });
  }

  const { db, pool } = createDatabase(databaseUrl(TEMPLATE_DATABASE));
  try {
    await runMigrations(db);
  } finally {
    // Пока к шаблону есть подключения, копировать его нельзя.
    await pool.end();
  }
}
