import type { FastifyBaseLogger } from 'fastify';
import { Redis } from 'ioredis';

// Две роли подключения: в режиме подписки (SUBSCRIBE) соединение не выполняет обычные
// команды, поэтому подписчику нужно своё.
export type ValkeyRole = 'commands' | 'subscriber';

// Клиент Valkey (протокол совместим с Redis, клиент — ioredis). Valkey здесь необязателен:
// приложение должно работать и тогда, когда он недоступен, поэтому команды не ждут
// соединения, а сразу завершаются ошибкой — вызывающий код откатывается на БД.
export function createValkeyClient(
  url: string,
  role: ValkeyRole,
  logger: FastifyBaseLogger,
): Redis {
  const log = logger.child({ component: 'valkey', role });
  const client = new Redis(url, {
    // Имя соединения видно в CLIENT LIST на сервере.
    connectionName: `foodster-api-${role}`,
    ...(role === 'commands'
      ? {
          // Нет соединения — ошибка сразу, а не очередь до переподключения: запрос оператора
          // не должен ждать кэш.
          enableOfflineQueue: false,
          // Ответа нет дольше секунды — ошибка; кэш не должен замедлять ответы.
          commandTimeout: 1_000,
          // Команды, оставшиеся без ответа при обрыве, ioredis отклоняет, когда число попыток
          // переподключения кратно (maxRetriesPerRequest + 1): здесь — на второй попытке,
          // а не на двадцать первой, как по умолчанию.
          maxRetriesPerRequest: 1,
        }
      : {
          // Подписку можно оформить заранее: она уйдёт на сервер, как только появится соединение,
          // и после каждого переподключения ioredis подпишется заново (autoResubscribe).
          enableOfflineQueue: true,
          // Ждать соединения бесконечно. С числом ioredis после стольких неудачных попыток
          // выбросил бы из очереди и SUBSCRIBE — Valkey, поднявшийся позже приложения, уже
          // не прислал бы ни одного события до перезапуска.
          maxRetriesPerRequest: null,
        }),
  });

  // Без обработчика 'error' ошибки подключения шли бы мимо нашего логгера. Пока Valkey
  // недоступен, ioredis переподключается каждые несколько секунд — одинаковые ошибки
  // подряд пишем один раз.
  let lastError: string | undefined;
  client.on('error', (error: Error) => {
    if (error.message === lastError) return;
    lastError = error.message;
    log.warn({ err: error }, 'Valkey connection error');
  });
  client.on('ready', () => {
    lastError = undefined;
    log.info('Valkey connected');
  });
  return client;
}
