import { DEV_OPERATOR_PASSWORD } from '@foodster/shared';
import { createDatabase } from '../db/client';
import { seedIfEmpty } from '../db/seed';
import { requireEnv } from '../env';
import { logger } from '../logger';

const log = logger.child({ script: 'seed' });

// --on-start — запуск из start-команды (Render): заполняем базу, только если это включено
// переменной SEED_ON_START=true. Ручной запуск (npm run db:seed) запускает seed всегда.
// В обоих случаях заполняется только пустая база (seedIfEmpty), так что повтор безопасен.
const onStart = process.argv.includes('--on-start');
if (onStart && process.env.SEED_ON_START !== 'true') {
  log.info('SEED_ON_START is not "true": seed skipped');
} else {
  await seed();
}

async function seed(): Promise<void> {
  // Пароль один на всех операторов. В production это секрет из окружения: пароль разработки
  // написан в коде, и на стенде его знал бы любой, кто открыл репозиторий.
  // Пустая строка — то же, что не задан.
  const password = process.env.SEED_OPERATOR_PASSWORD || undefined;
  if (
    process.env.NODE_ENV === 'production' &&
    (password === undefined || password === DEV_OPERATOR_PASSWORD)
  ) {
    log.error('SEED_OPERATOR_PASSWORD is required in production and must differ from the dev one');
    process.exitCode = 1;
    return;
  }
  const { db, pool } = createDatabase(requireEnv('DATABASE_URL'));
  try {
    const result = await seedIfEmpty(db, { operatorPassword: password ?? DEV_OPERATOR_PASSWORD });
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
}
