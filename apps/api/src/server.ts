import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

function resolveWebRoot(): string {
  const root = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  // Без сборки фронта сервис отвечал бы 404 на главной — лучше упасть при старте с понятной
  // причиной (обычно забыли npm run build).
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`Web build not found at ${root}: run npm run build`);
  }
  return root;
}

// Если текущие запросы не завершатся за это время, выходим принудительно.
const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
// Собранный фронт (npm run build) — в production его отдаёт само API. Путь одинаков от
// src/server.ts и от собранного dist/server.js: apps/api/<папка>/ → apps/web/dist.
// Проверяем до подключения к БД и Valkey: без сборки падаем сразу.
const webRoot = config.NODE_ENV === 'production' ? resolveWebRoot() : undefined;
// За прокси без TRUST_PROXY IP любого клиента — адрес прокси: лимит попыток входа стал бы
// общим на всех. Не ошибка (сервис может работать и без прокси), но в логе должно быть видно.
if (config.NODE_ENV === 'production' && config.TRUST_PROXY === undefined) {
  logger.warn(
    'TRUST_PROXY is not set: behind a proxy every client shares the proxy IP (login rate limit, logs)',
  );
}

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

const app = await buildApp({ config, db, orderEvents, cache, webRoot });

async function closeResources(): Promise<void> {
  // disconnect, а не quit: ждать ответа от недоступного Valkey при остановке незачем.
  for (const client of valkeyClients) client.disconnect();
  await pool.end();
}

// Graceful shutdown: перестаём принимать новые запросы, закрываем SSE-потоки, дожидаемся
// текущих запросов, затем закрываем соединения с Valkey и пул БД.
// Render присылает SIGTERM при деплое (через 60 с после переключения трафика на новый инстанс,
// SIGKILL — ещё через 30 с); Ctrl+C в терминале — SIGINT.
// Сигнал может прийти дважды: если платформа шлёт его всей группе процессов, node получает
// и свой, и пересланный от npm. Повторный игнорируем — иначе процесс умер бы сразу,
// не закрыв соединения (поведение Node по умолчанию, когда обработчика нет).
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
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
process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'Server failed to start');
  await closeResources();
  process.exitCode = 1;
}
