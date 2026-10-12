import { orderChangedEventSchema, type OrderChangedEvent } from '@foodster/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';

interface OrderEventSubscriber {
  onChange(event: OrderChangedEvent): void;
  // События могли потеряться (обрыв связи с Valkey). Подписчик должен заново получить
  // актуальные данные: SSE-поток для этого закрывается, браузер переподключается
  // и перезапрашивает данные.
  onGap(): void;
}

// Шина событий «заказ изменился». Изменение публикуется после коммита транзакции,
// подписчики — открытые SSE-потоки операторов.
export interface OrderEventBus {
  // Не бросает: изменение уже сохранено, и сбой доставки события не должен превращать
  // успешный ответ в ошибку.
  publish(event: OrderChangedEvent): Promise<void>;
  // Возвращает функцию отписки.
  subscribe(subscriber: OrderEventSubscriber): () => void;
}

// Раздача подписчикам этого процесса. Ошибка одного подписчика не мешает остальным.
function createSubscriberSet(logger: FastifyBaseLogger) {
  const subscribers = new Set<OrderEventSubscriber>();
  const each = (notify: (subscriber: OrderEventSubscriber) => void) => {
    for (const subscriber of subscribers) {
      try {
        notify(subscriber);
      } catch (error) {
        logger.error({ err: error }, 'Order event subscriber failed');
      }
    }
  };
  return {
    add(subscriber: OrderEventSubscriber): () => void {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    change: (event: OrderChangedEvent) => each((subscriber) => subscriber.onChange(event)),
    gap: () => each((subscriber) => subscriber.onGap()),
  };
}

// Без Valkey: события живут внутри процесса. На одном инстансе (как на Render Free)
// этого достаточно; при нескольких инстансах оператор увидел бы только изменения,
// сделанные через «свой» инстанс.
export function createLocalOrderEventBus(logger: FastifyBaseLogger): OrderEventBus {
  const subscribers = createSubscriberSet(logger);
  return {
    publish(event) {
      subscribers.change(event);
      return Promise.resolve();
    },
    subscribe: (subscriber) => subscribers.add(subscriber),
  };
}

const ORDER_EVENTS_CHANNEL = 'foodster:orders.changed';

export interface ValkeyOrderEventBus extends OrderEventBus {
  // Подписка подтверждена сервером. Сервер приложения её не ждёт (Valkey необязателен),
  // а тесты — ждут, чтобы не потерять первое событие.
  subscribed: Promise<void>;
}

// С Valkey: событие уходит в канал pub/sub и приходит всем инстансам, включая отправителя.
// Поэтому при успешной публикации локально ничего не раздаём — только то, что пришло из канала.
// Соединения создаёт и закрывает вызывающий код (server.ts).
export function createValkeyOrderEventBus(options: {
  publisher: Redis;
  subscriber: Redis;
  logger: FastifyBaseLogger;
  channel?: string;
}): ValkeyOrderEventBus {
  const { publisher, subscriber, logger, channel = ORDER_EVENTS_CHANNEL } = options;
  const subscribers = createSubscriberSet(logger);

  subscriber.on('message', (from: string, message: string) => {
    if (from !== channel) return;
    // Данные из сети — проверяем схемой: другая версия приложения могла отправить иной формат.
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      logger.warn({ channel }, 'Order event is not valid JSON, ignored');
      return;
    }
    const result = orderChangedEventSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn(
        { channel, issues: result.error.issues },
        'Order event has unexpected shape, ignored',
      );
      return;
    }
    subscribers.change(result.data);
  });

  // Пока подписчик был без связи, события из канала до него не доходили. Первое
  // подключение — не пропуск; каждое следующее — пропуск. Клиент мог подключиться ещё до
  // создания шины — тогда первое подключение уже было.
  let connectedBefore = subscriber.status === 'ready';
  subscriber.on('ready', () => {
    if (connectedBefore) subscribers.gap();
    connectedBefore = true;
  });

  const subscribed = subscriber.subscribe(channel).then(() => undefined);
  // Обработчик помечает отказ как обработанный (иначе — unhandled rejection), но тот,
  // кто ждёт subscribed, всё равно получит ошибку.
  subscribed.catch((error: unknown) => {
    logger.warn({ err: error, channel }, 'Order events subscription failed');
  });

  return {
    subscribed,
    async publish(event) {
      if (publisher.status === 'ready') {
        try {
          await publisher.publish(channel, JSON.stringify(event));
          return;
        } catch (error) {
          logger.warn({ err: error, orderId: event.orderId }, 'Order event was not published');
        }
      }
      // Valkey недоступен (ошибку подключения клиент уже записал в лог): доставляем хотя бы
      // подписчикам этого процесса. Если сервер всё же выполнил команду, но не успел ответить
      // (таймаут), событие придёт дважды — у него есть id записи audit, повтор легко отбросить.
      subscribers.change(event);
    },
    subscribe: (subscriber) => subscribers.add(subscriber),
  };
}
