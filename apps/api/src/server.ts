import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';

// Если текущие запросы (позже — SSE-подключения) не завершатся за это время, выходим принудительно.
const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);
const app = await buildApp({ config, db });

// Graceful shutdown: перестаём принимать новые запросы, дожидаемся текущих, закрываем пул.
// Render при деплое и остановке присылает SIGTERM; Ctrl+C в терминале — SIGINT.
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  const forceExit = setTimeout(() => {
    app.log.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  // Таймер не должен сам по себе удерживать процесс живым.
  forceExit.unref();
  try {
    await app.close();
    await pool.end();
  } catch (error) {
    app.log.error({ err: error }, 'Shutdown failed');
    process.exitCode = 1;
  }
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
