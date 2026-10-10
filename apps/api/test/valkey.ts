import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Redis } from 'ioredis';
import { requireEnv } from '../src/env';
import { logger } from '../src/logger';
import { createValkeyClient, type ValkeyRole } from '../src/valkey/client';

// Порт, на котором никто не слушает: так выглядит недоступный Valkey.
export const UNREACHABLE_VALKEY_URL = 'redis://127.0.0.1:1';

// Тесты делят один Valkey, поэтому у каждого свои ключи и каналы. Каналы pub/sub общие
// для всех баз Valkey (номер базы в URL на них не влияет) — уникальное имя обязательно.
export function uniqueName(kind: 'channel' | 'prefix'): string {
  return `test:${kind}:${randomUUID()}:`;
}

// Соединение для команд создано без очереди: пока оно не готово, команды сразу отклоняются.
// Конструктор подключается асинхронно, поэтому перед первой командой ждём 'ready'.
export async function untilReady(client: Redis): Promise<Redis> {
  if (client.status !== 'ready') await once(client, 'ready');
  return client;
}

// Клиенты, созданные в тесте; disconnect() закрывает их все.
export function valkeyClients(url = requireEnv('TEST_REDIS_URL')) {
  const created: Redis[] = [];
  return {
    create(role: ValkeyRole): Redis {
      const client = createValkeyClient(url, role, logger);
      created.push(client);
      return client;
    },
    // То же, но готовое к командам.
    ready(role: ValkeyRole): Promise<Redis> {
      return untilReady(this.create(role));
    },
    disconnect(): void {
      for (const client of created) client.disconnect();
    },
  };
}
