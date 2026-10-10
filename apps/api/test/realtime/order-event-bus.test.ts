import type { OrderChangedEvent } from '@foodster/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { logger } from '../../src/logger';
import {
  createLocalOrderEventBus,
  createValkeyOrderEventBus,
  type OrderEventBus,
} from '../../src/realtime/order-event-bus';
import { UNREACHABLE_VALKEY_URL, uniqueName, valkeyClients } from '../valkey';

function changeOf(orderId: number): OrderChangedEvent {
  return {
    orderId,
    event: {
      id: orderId * 10,
      action: 'status_changed',
      fromStatus: 'new',
      toStatus: 'accepted',
      fromCourier: null,
      toCourier: null,
      reason: null,
      actor: { id: 1, name: 'Анна Операторова' },
      orderVersion: 2,
      createdAt: '2026-10-10T12:00:00.000Z',
    },
  };
}

const ignoreGap = () => undefined;

// Подписчик, который складывает события в массив.
function collect(bus: OrderEventBus) {
  const events: number[] = [];
  const unsubscribe = bus.subscribe({
    onChange: (event) => events.push(event.orderId),
    onGap: ignoreGap,
  });
  return { events, unsubscribe };
}

// Следующее событие шины (или следующее с нужным заказом). Ждём факт доставки,
// а не фиксированное время.
function nextEvent(bus: OrderEventBus, orderId?: number): Promise<OrderChangedEvent> {
  const { promise, resolve } = Promise.withResolvers<OrderChangedEvent>();
  const unsubscribe = bus.subscribe({
    onChange: (event) => {
      if (orderId !== undefined && event.orderId !== orderId) return;
      unsubscribe();
      resolve(event);
    },
    onGap: ignoreGap,
  });
  return promise;
}

describe('без Valkey: события внутри процесса', () => {
  it('подписчик получает опубликованное событие, после отписки — нет', async () => {
    const bus = createLocalOrderEventBus(logger);
    const { events, unsubscribe } = collect(bus);
    await bus.publish(changeOf(1));
    unsubscribe();
    await bus.publish(changeOf(2));
    expect(events).toEqual([1]);
  });

  it('ошибка одного подписчика не мешает остальным', async () => {
    const bus = createLocalOrderEventBus(logger);
    bus.subscribe({
      onChange: () => {
        throw new Error('broken subscriber');
      },
      onGap: ignoreGap,
    });
    const { events } = collect(bus);
    await bus.publish(changeOf(1));
    expect(events).toEqual([1]);
  });
});

describe('с Valkey: pub/sub между инстансами', () => {
  const clients = valkeyClients();
  afterAll(() => clients.disconnect());

  // Инстанс приложения: своё подключение для публикации и своё для подписки.
  async function instance(channel: string) {
    const subscriber = clients.create('subscriber');
    const bus = createValkeyOrderEventBus({
      publisher: await clients.ready('commands'),
      subscriber,
      logger,
      channel,
    });
    await bus.subscribed;
    return { bus, subscriber };
  }

  it('событие, опубликованное одним инстансом, получают оба — и другой, и он сам; по одному разу', async () => {
    const channel = uniqueName('channel');
    const first = await instance(channel);
    const second = await instance(channel);
    const atFirst = collect(first.bus);

    const atSecond = nextEvent(second.bus);
    await first.bus.publish(changeOf(7));
    expect(await atSecond).toEqual(changeOf(7));
    // Маркер (заказ 8) публикует второй инстанс уже после того, как сервер разослал 7.
    // На соединении подписчика первого инстанса 8 поэтому всегда приходит после 7: когда
    // маркер дошёл, все копии 7 уже были бы получены. Ждём именно 8: до первого инстанса
    // само 7 могло дойти позже, чем до второго.
    const marker = nextEvent(first.bus, 8);
    await second.bus.publish(changeOf(8));
    await marker;
    expect(atFirst.events).toEqual([7, 8]);
  });

  it('сообщение чужого формата в канале игнорируется', async () => {
    const channel = uniqueName('channel');
    const { bus } = await instance(channel);
    const received = nextEvent(bus);

    const raw = await clients.ready('commands');
    await raw.publish(channel, 'not json');
    await raw.publish(channel, JSON.stringify({ orderId: 'abc' }));
    await bus.publish(changeOf(3));
    // Каждую публикацию дожидаемся, поэтому сервер разослал сообщения именно в этом порядке:
    // первым дошло бы мусорное, если бы его не отбросили.
    expect(await received).toEqual(changeOf(3));
  });

  // В instance() подписчик успевает подключиться до создания шины — шина должна это учесть.
  it('после переподключения подписчика — сигнал о возможном пропуске событий', async () => {
    const { bus, subscriber } = await instance(uniqueName('channel'));
    const { promise: gap, resolve } = Promise.withResolvers<void>();
    bus.subscribe({ onChange: () => undefined, onGap: resolve });
    // Разорвать соединение и дать ioredis переподключиться, как при сбое сети.
    subscriber.disconnect(true);
    await gap;
  });

  it('Valkey недоступен: publish не бросает и доставляет событие подписчикам своего процесса', async () => {
    const unreachable = valkeyClients(UNREACHABLE_VALKEY_URL);
    try {
      const bus = createValkeyOrderEventBus({
        publisher: unreachable.create('commands'),
        subscriber: unreachable.create('subscriber'),
        logger,
        channel: uniqueName('channel'),
      });
      const { events } = collect(bus);
      await expect(bus.publish(changeOf(1))).resolves.toBeUndefined();
      expect(events).toEqual([1]);
    } finally {
      unreachable.disconnect();
    }
  });
});
