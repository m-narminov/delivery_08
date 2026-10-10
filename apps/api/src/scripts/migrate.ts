import { createDatabase } from '../db/client';
import { runMigrations } from '../db/migrations';
import { requireEnv } from '../env';
import { logger } from '../logger';

const log = logger.child({ script: 'migrate' });
const { db, pool } = createDatabase(requireEnv('DATABASE_URL'));
try {
  await runMigrations(db);
  log.info('Migrations applied');
} catch (error) {
  log.error({ err: error }, 'Migrations failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
