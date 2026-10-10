import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);
const app = await buildApp({ config, db });

// Graceful shutdown: перестаём принимать новые запросы, дожидаемся текущих, закрываем пул.
// Render при деплое и остановке присылает SIGTERM; Ctrl+C в терминале — SIGINT.
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await pool.end();
}
process.once('SIGTERM', (signal) => void shutdown(signal));
process.once('SIGINT', (signal) => void shutdown(signal));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'Server failed to start');
  await pool.end();
  process.exitCode = 1;
}
