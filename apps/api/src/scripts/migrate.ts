import { createDatabase } from '../db/client';
import { runMigrations } from '../db/migrations';
import { requireEnv } from '../env';

const { db, pool } = createDatabase(requireEnv('DATABASE_URL'));
try {
  await runMigrations(db);
  console.log('Migrations applied');
} finally {
  await pool.end();
}
