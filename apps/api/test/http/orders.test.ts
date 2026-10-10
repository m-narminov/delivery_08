import type { Courier, Order, OrderEvent, OrderList, Restaurant } from '@foodster/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client';
import { operators } from '../../src/db/schema';
import { SESSION_COOKIE } from '../../src/http/session';
import { createTestApp, insertOperator, loginAs, type TestApp } from '../app';
import { insertCourier, insertOrder, insertOrderEvent, insertRestaurant } from '../factories';

let app: TestApp;
let db: Database;
let close: () => Promise<void>;
let session: string;

// Фиксированный набор: каждое ожидание в тестах вычислимо глазами.
const ids = { o1: 0, o2: 0, o3: 0, o4: 0, o5: 0 };
const refs = { pizza: 0, sushi: 0, ivan: 0, petr: 0, operator: 0 };
const BASE = Date.parse('2026-10-01T10:00:00Z');
const at = (hours: number) => new Date(BASE + hours * 60 * 60 * 1000);

beforeAll(async () => {
  const testApp = await createTestApp();
  app = testApp.app;
  db = testApp.db;
  close = testApp.close;

  const operator = await insertOperator(db, { name: 'Анна Операторова' });
  refs.operator = operator.id;
  session = await loginAs(app, operator.id);

  const pizza = await insertRestaurant(db, 'Пицца');
  const sushi = await insertRestaurant(db, 'Суши');
  const ivan = await insertCourier(db, 'Иван Курьеров');
  const petr = await insertCourier(db, 'Пётр Быстров');
  Object.assign(refs, { pizza: pizza.id, sushi: sushi.id, ivan: ivan.id, petr: petr.id });

  const o1 = await insertOrder(db, {
    status: 'new',
    restaurantId: pizza.id,
    deliveryAddress: 'г. Москва, Садовая ул., д. 5, кв. 12',
    amountMinor: 150_000,
    createdAt: at(0),
    updatedAt: at(10),
  });
  const o2 = await insertOrder(db, {
    status: 'ready',
    restaurantId: pizza.id,
    courierId: ivan.id,
    deliveryAddress: 'г. Москва, ул. Королёва, д. 3',
    amountMinor: 50_000,
    version: 3,
    createdAt: at(1),
    updatedAt: at(1.5),
  });
  const o3 = await insertOrder(db, {
    status: 'picked_up',
    restaurantId: sushi.id,
    courierId: ivan.id,
    deliveryAddress: 'Moscow, 12 Oak Street, Apt. 4',
    amountMinor: 300_000,
    createdAt: at(2),
    updatedAt: at(2.5),
  });
  const o4 = await insertOrder(db, {
    status: 'delivered',
    restaurantId: sushi.id,
    courierId: petr.id,
    deliveryAddress: 'г. Москва, Садово-Кудринская ул., д. 1',
    amountMinor: 90_000,
    createdAt: at(3),
    updatedAt: at(3.5),
  });
  const o5 = await insertOrder(db, {
    status: 'cancelled',
    restaurantId: pizza.id,
    deliveryAddress: 'г. Москва, ул. Ленина, д. 10',
    amountMinor: 70_000,
    createdAt: at(4),
    updatedAt: at(4.5),
  });
  Object.assign(ids, { o1: o1.id, o2: o2.id, o3: o3.id, o4: o4.id, o5: o5.id });

  // История o2: версии 1..3 совпадают с version заказа.
  await insertOrderEvent(db, {
    orderId: o2.id,
    action: 'created',
    toStatus: 'new',
    orderVersion: 1,
    createdAt: at(1),
  });
  await insertOrderEvent(db, {
    orderId: o2.id,
    action: 'courier_assigned',
    toCourierId: ivan.id,
    actorId: operator.id,
    orderVersion: 2,
    createdAt: at(1.2),
  });
  await insertOrderEvent(db, {
    orderId: o2.id,
    action: 'status_changed',
    fromStatus: 'new',
    toStatus: 'ready',
    actorId: operator.id,
    orderVersion: 3,
    createdAt: at(1.5),
  });
});

afterAll(async () => {
  await close();
});

function get(url: string, headers: Record<string, string> = {}) {
  return app.inject({ method: 'GET', url, headers, cookies: { [SESSION_COOKIE]: session } });
}

async function listIds(query: string): Promise<number[]> {
  const response = await get(`/api/orders${query}`);
  expect(response.statusCode).toBe(200);
  return response.json<OrderList>().items.map((order) => order.id);
}

describe('доступ', () => {
  it.each([
    '/api/orders',
    '/api/orders/1',
    '/api/orders/1/events',
    '/api/restaurants',
    '/api/couriers',
  ])('%s без сессии → 401', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(401);
  });

  it('сессия удалённого оператора → 401', async () => {
    const removed = await insertOperator(db, { name: 'Удаляемый' });
    const removedSession = await loginAs(app, removed.id);
    await db.delete(operators).where(eq(operators.id, removed.id));
    const response = await app.inject({
      method: 'GET',
      url: '/api/orders',
      cookies: { [SESSION_COOKIE]: removedSession },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/orders — список', () => {
  it('по умолчанию: новые сверху, страница 1 по 20', async () => {
    const response = await get('/api/orders');
    const body = response.json<OrderList>();
    expect(body).toMatchObject({ total: 5, page: 1, pageSize: 20 });
    expect(body.items.map((order) => order.id)).toEqual([ids.o5, ids.o4, ids.o3, ids.o2, ids.o1]);
  });

  it('элемент списка: ресторан и курьер по имени, сумма в копейках, даты ISO', async () => {
    const response = await get('/api/orders');
    const o2 = response.json<OrderList>().items.find((order) => order.id === ids.o2);
    expect(o2).toEqual({
      id: ids.o2,
      status: 'ready',
      customerName: 'Иван Клиентов',
      customerPhone: '+70000000001',
      deliveryAddress: 'г. Москва, ул. Королёва, д. 3',
      amountMinor: 50_000,
      restaurant: { id: refs.pizza, name: 'Пицца' },
      courier: { id: refs.ivan, name: 'Иван Курьеров' },
      version: 3,
      createdAt: '2026-10-01T11:00:00.000Z',
      updatedAt: '2026-10-01T11:30:00.000Z',
    });
  });

  it('фильтр по нескольким статусам', async () => {
    expect(await listIds('?status=ready,picked_up')).toEqual([ids.o3, ids.o2]);
  });

  it('фильтр по ресторану', async () => {
    expect(await listIds(`?restaurantId=${refs.sushi}`)).toEqual([ids.o4, ids.o3]);
  });

  it('фильтры складываются (И)', async () => {
    expect(await listIds(`?status=delivered&restaurantId=${refs.sushi}`)).toEqual([ids.o4]);
  });

  // Все варианты сортировки целиком. Суммы: o2 < o5 < o4 < o1 < o3; создание: o1..o5 по часу;
  // изменение: o2, o3, o4, o5 и последним o1 (через 10 часов).
  it.each([
    ['createdAt:desc', ['o5', 'o4', 'o3', 'o2', 'o1']],
    ['createdAt:asc', ['o1', 'o2', 'o3', 'o4', 'o5']],
    ['updatedAt:desc', ['o1', 'o5', 'o4', 'o3', 'o2']],
    ['updatedAt:asc', ['o2', 'o3', 'o4', 'o5', 'o1']],
    ['amount:desc', ['o3', 'o1', 'o4', 'o5', 'o2']],
    ['amount:asc', ['o2', 'o5', 'o4', 'o1', 'o3']],
  ] as const)('сортировка %s', async (sort, expected) => {
    expect(await listIds(`?sort=${sort}`)).toEqual(expected.map((key) => ids[key]));
  });

  it('пагинация: вторая страница по 2', async () => {
    const response = await get('/api/orders?pageSize=2&page=2');
    const body = response.json<OrderList>();
    expect(body).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(body.items.map((order) => order.id)).toEqual([ids.o3, ids.o2]);
  });

  it('страница за пределами — пустой список, total прежний', async () => {
    const response = await get('/api/orders?pageSize=2&page=4');
    expect(response.json<OrderList>()).toMatchObject({ items: [], total: 5 });
  });

  it.each([
    ['page=0', '?page=0'],
    ['неизвестный статус', '?status=lost'],
    ['pageSize больше 100', '?pageSize=101'],
  ])('%s → 400', async (_case, query) => {
    const response = await get(`/api/orders${query}`);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/orders — поиск по адресу', () => {
  it.each([
    ['опечатка', 'садвая', 'o1'],
    ['ё и е', 'королева', 'o2'],
    ['не та раскладка', 'cfljdfz', 'o1'],
    ['транслит', 'sadovaya', 'o1'],
    ['адрес латиницей', 'oak', 'o3'],
    ['латиница в русской раскладке', 'щфл', 'o3'],
  ] as const)('%s: «%s» → %s первым', async (_case, q, expected) => {
    const found = await listIds(`?q=${encodeURIComponent(q)}`);
    expect(found[0]).toBe(ids[expected]);
  });

  it('самые похожие адреса — первыми', async () => {
    const found = await listIds(`?q=${encodeURIComponent('садовая')}`);
    expect(found.slice(0, 2)).toEqual([ids.o1, ids.o4]);
    expect(found).not.toContain(ids.o5);
  });

  it('поиск сочетается с фильтром', async () => {
    expect(await listIds(`?q=${encodeURIComponent('садовая')}&status=delivered`)).toEqual([ids.o4]);
  });

  it('символ NUL в поиске → 400, а не 500 от Postgres', async () => {
    const response = await get('/api/orders?q=%00');
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('ничего похожего — пустой список и total 0', async () => {
    const response = await get('/api/orders?q=zzzz');
    expect(response.json<OrderList>()).toMatchObject({ items: [], total: 0 });
  });
});

describe('GET /api/orders/:id — карточка', () => {
  it('отдаёт заказ, ETag с версией и запрет общих кэшей', async () => {
    const response = await get(`/api/orders/${ids.o2}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"v3"');
    expect(response.headers['cache-control']).toBe('private, no-cache');
    expect(response.json<Order>()).toMatchObject({ id: ids.o2, version: 3, status: 'ready' });
  });

  it('If-None-Match с текущим ETag → 304 без тела', async () => {
    const response = await get(`/api/orders/${ids.o2}`, { 'if-none-match': '"v3"' });
    expect(response.statusCode).toBe(304);
    expect(response.body).toBe('');
  });

  it('If-None-Match со старым ETag → 200', async () => {
    const response = await get(`/api/orders/${ids.o2}`, { 'if-none-match': '"v2"' });
    expect(response.statusCode).toBe(200);
  });

  it('несуществующий заказ → 404 problem+json', async () => {
    const response = await get('/api/orders/999999');
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string; detail: string }>()).toMatchObject({
      code: 'NOT_FOUND',
      detail: 'Заказ 999999 не найден',
    });
  });

  it('id не число → 400', async () => {
    const response = await get('/api/orders/abc');
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/orders/:id/events — audit log', () => {
  it('история по возрастанию версии, с именами оператора и курьера', async () => {
    const response = await get(`/api/orders/${ids.o2}/events`);
    expect(response.statusCode).toBe(200);
    const events = response.json<OrderEvent[]>();
    expect(events.map((event) => [event.orderVersion, event.action])).toEqual([
      [1, 'created'],
      [2, 'courier_assigned'],
      [3, 'status_changed'],
    ]);
    expect(events[0]).toMatchObject({ actor: null, toStatus: 'new' });
    expect(events[1]).toMatchObject({
      actor: { id: refs.operator, name: 'Анна Операторова' },
      toCourier: { id: refs.ivan, name: 'Иван Курьеров' },
      fromCourier: null,
    });
    expect(events[2]).toMatchObject({ fromStatus: 'new', toStatus: 'ready' });
  });

  it('у заказа без истории — пустой список', async () => {
    const response = await get(`/api/orders/${ids.o1}/events`);
    expect(response.json<OrderEvent[]>()).toEqual([]);
  });

  it('несуществующий заказ → 404', async () => {
    const response = await get('/api/orders/999999/events');
    expect(response.statusCode).toBe(404);
  });
});

describe('справочники', () => {
  it('рестораны по алфавиту', async () => {
    const response = await get('/api/restaurants');
    expect(response.json<Restaurant[]>()).toEqual([
      { id: refs.pizza, name: 'Пицца' },
      { id: refs.sushi, name: 'Суши' },
    ]);
  });

  it('курьеры с числом активных доставок (ready и picked_up)', async () => {
    const response = await get('/api/couriers');
    expect(response.json<Courier[]>()).toEqual([
      { id: refs.ivan, name: 'Иван Курьеров', phone: '+70000000000', activeDeliveries: 2 },
      { id: refs.petr, name: 'Пётр Быстров', phone: '+70000000000', activeDeliveries: 0 },
    ]);
  });
});
