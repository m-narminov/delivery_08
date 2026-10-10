import { createDatabase } from '../db/client';
import { DEFAULT_OPERATOR_PASSWORD, seedIfEmpty } from '../db/seed';
import { requireEnv } from '../env';

const { db, pool } = createDatabase(requireEnv('DATABASE_URL'));
try {
  const result = await seedIfEmpty(db, {
    operatorPassword: process.env.SEED_OPERATOR_PASSWORD ?? DEFAULT_OPERATOR_PASSWORD,
  });
  console.log(result === 'seeded' ? 'Seed data inserted' : 'Database is not empty, seed skipped');
} finally {
  await pool.end();
}
