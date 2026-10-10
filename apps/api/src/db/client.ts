import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { logger } from '../logger';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(connectionString: string): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString });
  // Ошибка простаивающего соединения (например, БД перезапустилась). Без обработчика
  // событие 'error' уронило бы весь процесс.
  pool.on('error', (error) => {
    logger.error({ err: error }, 'Idle database connection failed');
  });
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}
