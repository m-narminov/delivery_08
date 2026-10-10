import { setTimeout as sleep } from 'node:timers/promises';
import {
  orderChangedEventSchema,
  type Courier,
  type OrderChangedEvent,
  type Restaurant,
} from '@foodster/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import type { Database } from '../../src/db/client';
import { couriers, restaurants } from '../../src/db/schema';
import { SESSION_COOKIE } from '../../src/http/session';
import { MAX_STREAMS_PER_OPERATOR } from '../../src/modules/stream/stream.routes';
import { createValkeyCache } from '../../src/cache/cache';
import { logger } from '../../src/logger';
import { createValkeyOrderEventBus } from '../../src/realtime/order-event-bus';
import {
  createTestApp,
  insertOperator,
  loginAs,
  problemBody,
  testConfig,
  testValkeyDependencies,
  type TestApp,
} from '../app';
import { createTestDatabase, type TestDatabase } from '../db';
import { insertCourier, insertOrder, insertRestaurant } from '../factories';
import { UNREACHABLE_VALKEY_URL, uniqueName, valkeyClients } from '../valkey';

const ignoreGap = () => undefined;

// Адрес приложения на случайном порту. SSE читаем по настоящему HTTP-соединению:
// inject не умеет отдавать бесконечный ответ по частям.
async function addressOf(app: TestApp): Promise<string> {
  const address = app.server.address();
  if (address && typeof address === 'object') return `http://127.0.0.1:${address.port}`;
  return app.listen({ host: '127.0.0.1', port: 0 });
}

// Открывает SSE-поток так же, как браузер. Сообщения SSE разделены пустой строкой.
async function openStream(app: TestApp, session: string) {
  const response = await fetch(`${await addressOf(app)}/api/stream`, {
    headers: { cookie: `${SESSION_COOKIE}=${session}` },
  });
  // Тело забираем на чтение только при первом next(): у ответа с ошибкой (429) тест читает
  // его как JSON, а прочитать тело дважды нельзя.
  let reader: ReadableStreamDefaultReader<string> | undefined;
  let buffer = '';

  return {
    response,
    // Следующее сообщение целиком; null — сервер закрыл поток.
    async next(): Promise<string | null> {
      if (!response.body) throw new Error('stream has no body');
      reader ??= response.body.pipeThrough(new TextDecoderStream()).getReader();
      while (!buffer.includes('\n\n')) {
        const { done, value } = await reader.read();
        if (done) return null;
        buffer += value;
      }
      const end = buffer.indexOf('\n\n');
      const message = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      return message;
    },
    // Закрыть соединение со стороны клиента, как при закрытии вкладки.
    cancel: async () => {
      await (reader ? reader.cancel() : response.body?.cancel());
    },
  };
}

// Поля сообщения SSE: «event: …» и «data: …».
function parseMessage(message: string | null): { event?: string; data?: unknown } {
  const fields = Object.fromEntries(
    (message ?? '').split('\n').map((line) => {
      const separator = line.indexOf(': ');
      return [line.slice(0, separator), line.slice(separator + 2)];
    }),
  );
  return {
    event: fields.event,
    data: fields.data === undefined ? undefined : (JSON.parse(fields.data) as unknown),
  };
}

describe('GET /api/stream', () => {
  let app: TestApp;
  let db: Database;
  let close: () => Promise<void>;
  let restaurantId: number;

  beforeAll(async () => {
    const testApp = await createTestApp();
    ({ app, db, close } = testApp);
    restaurantId = (await insertRestaurant(db, 'Пицца')).id;
  });

  afterAll(async () => {
    await close();
  });

  // У каждого теста свой оператор: лимит потоков считается на оператора.
  async function newSession(name = 'Анна Операторова') {
    const operator = await insertOperator(db, { name });
    return { operatorId: operator.id, session: await loginAs(app, operator.id) };
  }

  it('без сессии → 401 problem+json', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/stream' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(problemBody(response).code).toBe('UNAUTHORIZED');
  });

  it('HEAD не открывает поток', async () => {
    const { session } = await newSession();
    const response = await app.inject({
      method: 'HEAD',
      url: '/api/stream',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(response.statusCode).toBe(404);
  });

  it('после изменения заказа приходит order.changed с записью audit и автором', async () => {
    const { operatorId, session } = await newSession();
    const order = await insertOrder(db, { restaurantId });
    const stream = await openStream(app, session);
    try {
      expect(stream.response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
      expect(stream.response.headers.get('cache-control')).toBe('no-store');
      expect(await stream.next()).toBe('retry: 3000');

      const changed = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/transitions`,
        payload: { to: 'accepted' },
        headers: { 'if-match': '"v1"' },
        cookies: { [SESSION_COOKIE]: session },
      });
      expect(changed.statusCode).toBe(200);

      const message = parseMessage(await stream.next());
      expect(message.event).toBe('order.changed');
      expect(orderChangedEventSchema.parse(message.data)).toMatchObject({
        orderId: order.id,
        event: {
          action: 'status_changed',
          fromStatus: 'new',
          toStatus: 'accepted',
          orderVersion: 2,
          actor: { id: operatorId, name: 'Анна Операторова' },
        },
      });
    } finally {
      await stream.cancel();
    }
  });

  it('изменение без эффекта (тот же курьер) и отказ (409) событий не публикуют', async () => {
    const { session } = await newSession();
    const courier = await insertCourier(db, 'Курьер');
    const order = await insertOrder(db, {
      restaurantId,
      status: 'preparing',
      courierId: courier.id,
    });
    const published: OrderChangedEvent[] = [];
    const unsubscribe = app.orderEvents.subscribe({
      onChange: (event) => published.push(event),
      onGap: ignoreGap,
    });
    try {
      const send = (method: 'PUT' | 'POST', url: string, payload: object) =>
        app.inject({
          method,
          url,
          payload,
          headers: { 'if-match': '"v1"' },
          cookies: { [SESSION_COOKIE]: session },
        });
      // Без Valkey публикация синхронна: к моменту ответа событие уже было бы получено.
      const same = await send('PUT', `/api/orders/${order.id}/courier`, { courierId: courier.id });
      expect(same.statusCode).toBe(200);
      const rejected = await send('POST', `/api/orders/${order.id}/transitions`, {
        to: 'delivered',
      });
      expect(rejected.statusCode).toBe(409);
      expect(published).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it(`не больше ${MAX_STREAMS_PER_OPERATOR} потоков на оператора; закрытый поток освобождает место`, async () => {
    const { session } = await newSession();
    const streams = await Promise.all(
      Array.from({ length: MAX_STREAMS_PER_OPERATOR }, () => openStream(app, session)),
    );
    try {
      expect(streams.map((stream) => stream.response.status)).toEqual(
        Array.from({ length: MAX_STREAMS_PER_OPERATOR }, () => 200),
      );
      const extra = await openStream(app, session);
      expect(extra.response.status).toBe(429);
      expect(await extra.response.json()).toMatchObject({ code: 'STREAM_LIMIT_REACHED' });

      // Клиент закрыл один поток. Сервер узнаёт об этом по событию 'close' — не мгновенно,
      // поэтому пробуем, пока место не освободится (или до таймаута теста).
      await streams.pop()?.cancel();
      for (;;) {
        const retry = await openStream(app, session);
        if (retry.response.status === 200) {
          streams.push(retry);
          break;
        }
        expect(retry.response.status).toBe(429);
        await sleep(20);
      }
    } finally {
      await Promise.all(streams.map((stream) => stream.cancel()));
    }
  });

  it('поток закрывается, когда истекает сессия', async () => {
    const { operatorId } = await newSession();
    // Токен на 2 секунды: дольше поток жить не должен.
    const session = app.jwt.sign({ operatorId, name: 'Анна' }, { expiresIn: '2s' });
    const stream = await openStream(app, session);
    expect(await stream.next()).toBe('retry: 3000');
    expect(await stream.next()).toBeNull();
  });

  it('описан в OpenAPI как text/event-stream', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const spec = response.json<{
      paths: Record<string, { get?: { responses: Record<string, { content?: object }> } }>;
    }>();
    // Маршрут объявлен как '/' внутри префикса /api/stream — в спецификации путь со слешем.
    const responses = spec.paths['/api/stream/']?.get?.responses;
    expect(Object.keys(responses?.['200']?.content ?? {})).toEqual(['text/event-stream']);
    expect(Object.keys(responses ?? {})).toEqual(expect.arrayContaining(['401', '429']));
  });
});

describe('остановка приложения', () => {
  it('app.close() закрывает открытые потоки и не зависает', async () => {
    const testApp = await createTestApp();
    let closed = false;
    try {
      const operator = await insertOperator(testApp.db);
      const stream = await openStream(testApp.app, await loginAs(testApp.app, operator.id));
      expect(await stream.next()).toBe('retry: 3000');

      await testApp.close();
      closed = true;
      // Сервер завершил ответ: поток кончился.
      expect(await stream.next()).toBeNull();
    } finally {
      if (!closed) await testApp.close();
    }
  });
});

describe('с Valkey', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.drop();
  });

  async function valkeyApp(channel?: string) {
    const valkey = await testValkeyDependencies(channel);
    const app = await buildApp({
      config: testConfig(),
      db: testDb.db,
      orderEvents: valkey.orderEvents,
      cache: valkey.cache,
    });
    return {
      app,
      valkey,
      close: async () => {
        await app.close();
        valkey.disconnect();
      },
    };
  }

  async function sessionFor(app: TestApp) {
    const operator = await insertOperator(testDb.db);
    return { operatorId: operator.id, session: await loginAs(app, operator.id) };
  }

  it('изменение через один инстанс доходит до подписчиков другого', async () => {
    const first = await valkeyApp();
    // Тот же канал — это тот же сервис, запущенный второй раз.
    const second = await valkeyApp(first.valkey.channel);
    try {
      const { session } = await sessionFor(first.app);
      const restaurant = await insertRestaurant(testDb.db, 'Суши');
      const order = await insertOrder(testDb.db, { restaurantId: restaurant.id });

      const { promise: received, resolve } = Promise.withResolvers<OrderChangedEvent>();
      second.app.orderEvents.subscribe({ onChange: resolve, onGap: ignoreGap });
      const response = await first.app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/cancel`,
        payload: { reason: 'Клиент передумал' },
        headers: { 'if-match': '"v1"' },
        cookies: { [SESSION_COOKIE]: session },
      });
      expect(response.statusCode).toBe(200);
      expect(await received).toMatchObject({
        orderId: order.id,
        event: { action: 'cancelled', reason: 'Клиент передумал' },
      });
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('связь с Valkey восстановилась — открытые потоки закрываются, чтобы клиент перезапросил данные', async () => {
    const instance = await valkeyApp();
    try {
      const { session } = await sessionFor(instance.app);
      const stream = await openStream(instance.app, session);
      expect(await stream.next()).toBe('retry: 3000');
      // Разорвать соединение подписчика и дать ioredis переподключиться, как при сбое сети.
      instance.valkey.subscriber.disconnect(true);
      expect(await stream.next()).toBeNull();
    } finally {
      await instance.close();
    }
  });

  it('справочники из кэша: имена курьеров и ресторанов — до истечения TTL, число активных доставок — всегда свежее', async () => {
    const instance = await valkeyApp();
    try {
      const { session } = await sessionFor(instance.app);
      const courier = await insertCourier(testDb.db, 'Иван Курьеров');
      const restaurant = await insertRestaurant(testDb.db, 'Бургеры');
      const get = async <T>(url: string) => {
        const response = await instance.app.inject({
          method: 'GET',
          url,
          cookies: { [SESSION_COOKIE]: session },
        });
        return response.json<T>();
      };
      const findCourier = async () =>
        (await get<Courier[]>('/api/couriers')).find((item) => item.id === courier.id);
      const findRestaurant = async () =>
        (await get<Restaurant[]>('/api/restaurants')).find((item) => item.id === restaurant.id);

      expect(await findCourier()).toMatchObject({ name: 'Иван Курьеров', activeDeliveries: 0 });
      expect(await findRestaurant()).toMatchObject({ name: 'Бургеры' });

      // В обход API: переименовать курьера и ресторан, дать курьеру активную доставку.
      await testDb.db
        .update(couriers)
        .set({ name: 'Иван Новый' })
        .where(eq(couriers.id, courier.id));
      await testDb.db
        .update(restaurants)
        .set({ name: 'Бургеры Новые' })
        .where(eq(restaurants.id, restaurant.id));
      await insertOrder(testDb.db, {
        restaurantId: restaurant.id,
        status: 'ready',
        courierId: courier.id,
      });

      expect(await findCourier()).toMatchObject({ name: 'Иван Курьеров', activeDeliveries: 1 });
      expect(await findRestaurant()).toMatchObject({ name: 'Бургеры' });
    } finally {
      await instance.close();
    }
  });

  it('Valkey недоступен: изменение заказа проходит, событие доходит до потоков своего процесса', async () => {
    const unreachable = valkeyClients(UNREACHABLE_VALKEY_URL);
    const commands = unreachable.create('commands');
    const orderEvents = createValkeyOrderEventBus({
      publisher: commands,
      subscriber: unreachable.create('subscriber'),
      logger,
      channel: uniqueName('channel'),
    });
    const cache = createValkeyCache({ client: commands, logger, prefix: uniqueName('prefix') });
    const app = await buildApp({ config: testConfig(), db: testDb.db, orderEvents, cache });
    try {
      const { session } = await sessionFor(app);
      const restaurant = await insertRestaurant(testDb.db, 'Пельмени');
      const order = await insertOrder(testDb.db, { restaurantId: restaurant.id });
      const published: OrderChangedEvent[] = [];
      app.orderEvents.subscribe({ onChange: (event) => published.push(event), onGap: ignoreGap });

      const response = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/transitions`,
        payload: { to: 'accepted' },
        headers: { 'if-match': '"v1"' },
        cookies: { [SESSION_COOKIE]: session },
      });
      expect(response.statusCode).toBe(200);
      expect(published.map((event) => event.orderId)).toEqual([order.id]);

      // Справочники — из БД.
      const list = await app.inject({
        method: 'GET',
        url: '/api/restaurants',
        cookies: { [SESSION_COOKIE]: session },
      });
      expect(list.statusCode).toBe(200);
    } finally {
      await app.close();
      unreachable.disconnect();
    }
  });
});
