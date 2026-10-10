import { createDatabase } from '../db/client';
import { DEFAULT_OPERATOR_PASSWORD, seedIfEmpty } from '../db/seed';
import { requireEnv } from '../env';
import { logger } from '../logger';

const log = logger.child({ script: 'seed' });
const { db, pool } = createDatabase(requireEnv('DATABASE_URL'));
try {
  const result = await seedIfEmpty(db, {
    operatorPassword: process.env.SEED_OPERATOR_PASSWORD ?? DEFAULT_OPERATOR_PASSWORD,
  });
  log.info(
    { result },
    result === 'seeded' ? 'Seed data inserted' : 'Database is not empty, seed skipped',
  );
} catch (error) {
  log.error({ err: error }, 'Seed failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
