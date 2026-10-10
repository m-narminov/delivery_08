import type { Redis } from 'ioredis';
import { buildApp } from './app';
import { createValkeyCache, noCache, type Cache } from './cache/cache';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { logger } from './logger';
import {
  createLocalOrderEventBus,
  createValkeyOrderEventBus,
  type OrderEventBus,
} from './realtime/order-event-bus';
import { createValkeyClient } from './valkey/client';

// Если текущие запросы не завершатся за это время, выходим принудительно.
const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);

// Valkey необязателен. С ним события об изменениях доходят до всех инстансов и работает кэш
// справочников; без него события остаются внутри процесса, а справочники читаются из БД.
let orderEvents: OrderEventBus;
let cache: Cache;
const valkeyClients: Redis[] = [];
if (config.REDIS_URL) {
  const commands = createValkeyClient(config.REDIS_URL, 'commands', logger);
  const subscriber = createValkeyClient(config.REDIS_URL, 'subscriber', logger);
  valkeyClients.push(commands, subscriber);
  orderEvents = createValkeyOrderEventBus({ publisher: commands, subscriber, logger });
  cache = createValkeyCache({ client: commands, logger });
} else {
  logger.info('REDIS_URL is not set: order events stay in-process, reference cache is disabled');
  orderEvents = createLocalOrderEventBus(logger);
  cache = noCache;
}

const app = await buildApp({ config, db, orderEvents, cache });

async function closeResources(): Promise<void> {
  // disconnect, а не quit: ждать ответа от недоступного Valkey при остановке незачем.
  for (const client of valkeyClients) client.disconnect();
  await pool.end();
}

// Graceful shutdown: перестаём принимать новые запросы, закрываем SSE-потоки, дожидаемся
// текущих запросов, затем закрываем соединения с Valkey и пул БД.
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
    await closeResources();
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
  await closeResources();
  process.exitCode = 1;
}
