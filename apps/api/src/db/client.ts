import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { logger } from '../logger';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(connectionString: string): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString,
    // Без таймаута подключения запрос (и health check) висит, пока БД недоступна.
    connectionTimeoutMillis: 5_000,
    // Таймауты на стороне Postgres — параметры каждой сессии (передаются при подключении):
    // - запрос дольше 15 с прерывается: зависший запрос не держит соединение из пула бесконечно;
    // - ожидание блокировки дольше 5 с прерывается (запрос получает 55P03 → 503), вместо того
    //   чтобы выстраивать за собой очередь. Больше deadlock_timeout (1 с), чтобы deadlock
    //   по-прежнему обнаруживался как deadlock;
    // - транзакция, которая открыта и ничего не делает дольше 30 с (например, код упал между
    //   запросами), закрывается сервером, и её блокировки снимаются.
    statement_timeout: 15_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  // Ошибка простаивающего соединения (например, БД перезапустилась). Без обработчика
  // событие 'error' уронило бы весь процесс.
  pool.on('error', (error) => {
    logger.error({ err: error }, 'Idle database connection failed');
  });
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}
