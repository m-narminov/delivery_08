import {
  courierLimitProblemSchema,
  versionConflictProblemSchema,
  type Courier,
  type Order,
  type OrderEvent,
  type OrderStatus,
} from '@foodster/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client';
import { SESSION_COOKIE } from '../../src/http/session';
import { createTestApp, insertOperator, loginAs, problemBody, type TestApp } from '../app';
import { insertCourier, insertOrder, insertRestaurant } from '../factories';

let app: TestApp;
let db: Database;
let close: () => Promise<void>;
let session: string;
let operatorId: number;
let restaurantId: number;

beforeAll(async () => {
  const testApp = await createTestApp();
  app = testApp.app;
  db = testApp.db;
  close = testApp.close;
  const operator = await insertOperator(db, { name: 'Анна Операторова' });
  operatorId = operator.id;
  session = await loginAs(app, operator.id);
  restaurantId = (await insertRestaurant(db, 'Пицца')).id;
});

afterAll(async () => {
  await close();
});

// Каждый тест создаёт свои заказы и курьеров — тесты не влияют друг на друга.
function newOrder(status: OrderStatus = 'new', courierId: number | null = null) {
  return insertOrder(db, { restaurantId, status, courierId });
}

let courierCounter = 0;
function newCourier() {
  courierCounter += 1;
  return insertCourier(db, `Курьер ${courierCounter}`);
}

function send(
  method: 'POST' | 'PUT',
  url: string,
  payload: object,
  ifMatch?: string,
  cookie = session,
) {
  return app.inject({
    method,
    url,
    payload,
    headers: ifMatch === undefined ? {} : { 'if-match': ifMatch },
    cookies: { [SESSION_COOKIE]: cookie },
  });
}

const transition = (id: number, to: string, ifMatch?: string) =>
  send('POST', `/api/orders/${id}/transitions`, { to }, ifMatch);
const setCourier = (id: number, courierId: number | null, ifMatch?: string) =>
  send('PUT', `/api/orders/${id}/courier`, { courierId }, ifMatch);
const cancel = (id: number, payload: object, ifMatch?: string) =>
  send('POST', `/api/orders/${id}/cancel`, payload, ifMatch);
// Причина отмены обязательна и не короче 30 символов (здесь 42).
const REASON = 'Клиент передумал и попросил отменить заказ';

async function activeDeliveries(courierId: number): Promise<number | undefined> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/couriers',
    cookies: { [SESSION_COOKIE]: session },
  });
  return response.json<Courier[]>().find((item) => item.id === courierId)?.activeDeliveries;
}

async function events(id: number): Promise<OrderEvent[]> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/orders/${id}/events`,
    cookies: { [SESSION_COOKIE]: session },
  });
  return response.json<OrderEvent[]>();
}

describe('If-Match: обнаружение конкурентных изменений', () => {
  it.each([
    ['переход', (id: number) => transition(id, 'accepted')],
    ['курьер', (id: number) => setCourier(id, null)],
    ['отмена', (id: number) => cancel(id, { reason: REASON })],
  ])('%s без If-Match → 428', async (_case, act) => {
    const order = await newOrder();
    const response = await act(order.id);
    expect(response.statusCode).toBe(428);
    expect(problemBody(response).code).toBe('PRECONDITION_REQUIRED');
    expect(problemBody(response).detail).toMatch(/[а-яё]/i);
  });

  it('If-Match со списком ETag: подходит любой из них', async () => {
    const order = await newOrder();
    expect((await transition(order.id, 'accepted', '"v0", "v1"')).statusCode).toBe(200);
  });

  it.each([
    ['без кавычек', 'v1'],
    ['с ведущим нулём (сравнение посимвольное)', '"v01"'],
  ])('If-Match %s не совпадает → 412', async (_case, ifMatch) => {
    const order = await newOrder();
    expect((await transition(order.id, 'accepted', ifMatch)).statusCode).toBe(412);
  });

  it('устаревшая версия → 412 с актуальным заказом и автором последнего изменения; ничего не записано', async () => {
    const order = await newOrder();
    // Оператор B успел принять заказ (версия 1 → 2)…
    expect((await transition(order.id, 'accepted', '"v1"')).statusCode).toBe(200);
    // …а оператор A всё ещё видит версию 1 и пытается сделать то же самое.
    const response = await transition(order.id, 'accepted', '"v1"');
    expect(response.statusCode).toBe(412);
    const body = versionConflictProblemSchema.parse(response.json());
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.detail).toBe(
      'Заказ уже изменил другой оператор. Обновите данные и повторите действие',
    );
    expect(body.current).toMatchObject({ id: order.id, version: 2, status: 'accepted' });
    expect(body.lastChange).toMatchObject({
      action: 'status_changed',
      toStatus: 'accepted',
      actor: { id: operatorId, name: 'Анна Операторова' },
    });
    expect(await events(order.id)).toHaveLength(1);
  });

  it('сценарий из задания: B назначил Alex, A с устаревшей версией назначает Maria → 412, Alex остаётся, виден автор B', async () => {
    const order = await newOrder('preparing');
    const alex = await newCourier();
    const maria = await newCourier();
    // Второй оператор со своей сессией.
    const operatorB = await insertOperator(db, { name: 'Борис Операторов' });
    const sessionB = await loginAs(app, operatorB.id);

    const byB = await send(
      'PUT',
      `/api/orders/${order.id}/courier`,
      { courierId: alex.id },
      '"v1"',
      sessionB,
    );
    expect(byB.statusCode).toBe(200);
    // Оператор A всё ещё видит версию 1.
    const response = await setCourier(order.id, maria.id, '"v1"');
    expect(response.statusCode).toBe(412);
    const body = versionConflictProblemSchema.parse(response.json());
    expect(body.current?.courier?.id).toBe(alex.id);
    expect(body.lastChange).toMatchObject({
      action: 'courier_assigned',
      toCourier: { id: alex.id },
      actor: { id: operatorB.id, name: 'Борис Операторов' },
    });
  });

  it('слабый ETag в If-Match не подходит (RFC 9110: только строгое сравнение) → 412', async () => {
    const order = await newOrder();
    expect((await transition(order.id, 'accepted', 'W/"v1"')).statusCode).toBe(412);
  });

  it('If-Match: * — любая текущая версия', async () => {
    const order = await newOrder();
    expect((await transition(order.id, 'accepted', '*')).statusCode).toBe(200);
  });

  it('несуществующий заказ → 404 (раньше проверки версии)', async () => {
    expect((await transition(999_999, 'accepted', '"v1"')).statusCode).toBe(404);
  });
});

describe('POST /api/orders/:id/transitions', () => {
  it('следующий статус: версия +1, новый ETag, запись в audit от оператора', async () => {
    // Заведомо старое время изменения: сравнение не зависит от того, уложились ли в 1 мс.
    const order = await insertOrder(db, {
      restaurantId,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const response = await transition(order.id, 'accepted', '"v1"');
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"v2"');
    // CDN не должен сжатием ослабить ETag: иначе следующее изменение получило бы 412.
    expect(response.headers['cache-control']).toBe('no-store, no-transform');
    const body = response.json<Order>();
    expect(body).toMatchObject({ status: 'accepted', version: 2 });
    expect(Date.parse(body.updatedAt)).toBeGreaterThan(order.updatedAt.getTime());
    expect(await events(order.id)).toMatchObject([
      {
        action: 'status_changed',
        fromStatus: 'new',
        toStatus: 'accepted',
        orderVersion: 2,
        actor: { id: operatorId },
      },
    ]);
  });

  it('вся цепочка до delivered, каждый шаг с ETag предыдущего ответа', async () => {
    const courier = await newCourier();
    const order = await newOrder('new', courier.id);
    let etag = '"v1"';
    for (const to of ['accepted', 'preparing', 'ready', 'picked_up', 'delivered']) {
      const response = await transition(order.id, to, etag);
      expect(response.statusCode).toBe(200);
      etag = response.headers.etag as string;
    }
    expect(etag).toBe('"v6"');
  });

  it('перескок через статус → 409 TRANSITION_NOT_ALLOWED', async () => {
    const order = await newOrder();
    const response = await transition(order.id, 'ready', '"v1"');
    expect(response.statusCode).toBe(409);
    expect(problemBody(response)).toMatchObject({
      code: 'TRANSITION_NOT_ALLOWED',
      detail: 'Такой переход статуса недоступен',
    });
  });

  it('откат назад → 409', async () => {
    const order = await newOrder('preparing');
    expect((await transition(order.id, 'accepted', '"v1"')).statusCode).toBe(409);
  });

  it('picked_up без курьера → 409 COURIER_REQUIRED', async () => {
    const order = await newOrder('ready');
    const response = await transition(order.id, 'picked_up', '"v1"');
    expect(response.statusCode).toBe(409);
    expect(problemBody(response).code).toBe('COURIER_REQUIRED');
  });

  it('cancelled через переходы → 400: для отмены отдельный эндпоинт', async () => {
    const order = await newOrder();
    expect((await transition(order.id, 'cancelled', '"v1"')).statusCode).toBe(400);
  });
});

describe('PUT /api/orders/:id/courier', () => {
  it('назначение, смена и снятие курьера — каждое со своей записью в audit', async () => {
    const order = await newOrder('preparing');
    const first = await newCourier();
    const second = await newCourier();

    const assigned = await setCourier(order.id, first.id, '"v1"');
    expect(assigned.json<Order>().courier).toEqual({ id: first.id, name: first.name });
    expect(assigned.headers.etag).toBe('"v2"');
    await setCourier(order.id, second.id, '"v2"');
    const removed = await setCourier(order.id, null, '"v3"');
    expect(removed.json<Order>()).toMatchObject({ courier: null, version: 4 });

    expect((await events(order.id)).map((event) => event.action)).toEqual([
      'courier_assigned',
      'courier_changed',
      'courier_unassigned',
    ]);
    const history = await events(order.id);
    expect(history[1]).toMatchObject({
      fromCourier: { id: first.id },
      toCourier: { id: second.id },
    });
    // Автор — у каждой записи, не только у смены статуса.
    expect(history.map((event) => event.actor?.id)).toEqual([operatorId, operatorId, operatorId]);
  });

  // Повтор того же запроса (например, после обрыва сети) безопасен — даже когда курьера
  // менять уже нельзя: менять нечего, значит, и правило не нарушено.
  it.each(['preparing', 'picked_up', 'delivered'] as const)(
    'тот же курьер повторно в %s — 200 без изменений: версия прежняя, audit пуст',
    async (status) => {
      const courier = await newCourier();
      const order = await newOrder(status, courier.id);
      const response = await setCourier(order.id, courier.id, '"v1"');
      expect(response.statusCode).toBe(200);
      expect(response.json<Order>().version).toBe(1);
      expect(await events(order.id)).toEqual([]);
    },
  );

  it('снятие курьера с заказа в ready освобождает место у курьера', async () => {
    const courier = await newCourier();
    const order = await newOrder('ready', courier.id);
    expect(await activeDeliveries(courier.id)).toBe(1);

    const response = await setCourier(order.id, null, '"v1"');
    expect(response.statusCode).toBe(200);
    expect(response.json<Order>()).toMatchObject({ courier: null, version: 2, status: 'ready' });
    expect(await events(order.id)).toMatchObject([
      { action: 'courier_unassigned', fromCourier: { id: courier.id }, toCourier: null },
    ]);
    expect(await activeDeliveries(courier.id)).toBe(0);
  });

  // Два пути кода: для заказа в ready курьер проверяется вместе с лимитом, для остальных — отдельно.
  it.each(['preparing', 'ready'] as const)(
    'несуществующий курьер для заказа в %s → 404 COURIER_NOT_FOUND',
    async (status) => {
      const order = await newOrder(status);
      const response = await setCourier(order.id, 999_999, '"v1"');
      expect(response.statusCode).toBe(404);
      expect(problemBody(response)).toMatchObject({
        code: 'COURIER_NOT_FOUND',
        detail: 'Курьер 999999 не найден',
      });
    },
  );

  it('после picked_up курьера менять нельзя → 409 COURIER_NOT_EDITABLE', async () => {
    const courier = await newCourier();
    const other = await newCourier();
    const order = await newOrder('picked_up', courier.id);
    const response = await setCourier(order.id, other.id, '"v1"');
    expect(response.statusCode).toBe(409);
    expect(problemBody(response).code).toBe('COURIER_NOT_EDITABLE');
  });
});

describe('лимит: не больше 3 активных доставок у курьера', () => {
  async function busyCourier() {
    const courier = await newCourier();
    await newOrder('ready', courier.id);
    await newOrder('picked_up', courier.id);
    await newOrder('picked_up', courier.id);
    return courier;
  }

  it('четвёртый заказ в ready не назначается → 409 COURIER_LIMIT_REACHED', async () => {
    const courier = await busyCourier();
    const order = await newOrder('ready');
    const response = await setCourier(order.id, courier.id, '"v1"');
    expect(response.statusCode).toBe(409);
    expect(courierLimitProblemSchema.parse(response.json())).toMatchObject({
      code: 'COURIER_LIMIT_REACHED',
      detail: 'У курьера уже максимум активных доставок: 3',
      activeDeliveries: 3,
      limit: 3,
      courier: { id: courier.id, name: courier.name },
    });
  });

  it('смена курьера на занятого (A → B, у B три активные) → 409, заказ остаётся у A', async () => {
    const first = await newCourier();
    const busy = await busyCourier();
    const order = await newOrder('ready', first.id);
    const response = await setCourier(order.id, busy.id, '"v1"');
    expect(response.statusCode).toBe(409);
    expect(problemBody(response).code).toBe('COURIER_LIMIT_REACHED');
    expect(await events(order.id)).toEqual([]);
    const card = await app.inject({
      method: 'GET',
      url: `/api/orders/${order.id}`,
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(card.json<Order>()).toMatchObject({ courier: { id: first.id }, version: 1 });
  });

  it('третья активная доставка назначается — граница лимита включительно', async () => {
    const courier = await newCourier();
    await newOrder('ready', courier.id);
    await newOrder('picked_up', courier.id);
    const third = await newOrder('ready');
    expect((await setCourier(third.id, courier.id, '"v1"')).statusCode).toBe(200);
  });

  it('заказ, который ещё готовится, назначить можно — он не активная доставка', async () => {
    const courier = await busyCourier();
    const order = await newOrder('preparing');
    expect((await setCourier(order.id, courier.id, '"v1"')).statusCode).toBe(200);
  });

  it('обход через смену статуса тоже закрыт: preparing → ready при 3 активных → 409', async () => {
    const courier = await busyCourier();
    const order = await newOrder('preparing', courier.id);
    const response = await transition(order.id, 'ready', '"v1"');
    expect(response.statusCode).toBe(409);
    expect(problemBody(response).code).toBe('COURIER_LIMIT_REACHED');
  });

  it('после доставки одного заказа место освобождается', async () => {
    const courier = await newCourier();
    await newOrder('ready', courier.id);
    await newOrder('picked_up', courier.id);
    const delivering = await newOrder('picked_up', courier.id);
    const waiting = await newOrder('preparing', courier.id);

    expect((await transition(waiting.id, 'ready', '"v1"')).statusCode).toBe(409);
    expect((await transition(delivering.id, 'delivered', '"v1"')).statusCode).toBe(200);
    expect((await transition(waiting.id, 'ready', '"v1"')).statusCode).toBe(200);
  });
});

describe('POST /api/orders/:id/cancel', () => {
  it('отмена из ready: причина в audit, курьер остаётся в заказе, но место у курьера освобождается', async () => {
    const courier = await newCourier();
    const order = await newOrder('ready', courier.id);
    const response = await cancel(order.id, { reason: `  ${REASON}  ` }, '"v1"');
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"v2"');
    expect(response.json<Order>()).toMatchObject({
      status: 'cancelled',
      version: 2,
      courier: { id: courier.id },
    });
    expect(await events(order.id)).toMatchObject([
      {
        action: 'cancelled',
        fromStatus: 'ready',
        toStatus: 'cancelled',
        reason: REASON,
        actor: { id: operatorId },
      },
    ]);

    expect(await activeDeliveries(courier.id)).toBe(0);
  });

  it.each([
    ['без причины', {}],
    ['пустая', { reason: '' }],
    ['из пробелов', { reason: '   ' }],
    ['29 символов после обрезки пробелов', { reason: `  ${'я'.repeat(29)}  ` }],
  ])('причина %s → 400 у поля reason, заказ не меняется', async (_case, payload) => {
    const order = await newOrder();
    const response = await cancel(order.id, payload, '"v1"');
    expect(response.statusCode).toBe(400);
    expect(problemBody(response)).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [expect.objectContaining({ path: '/reason' })],
    });
    expect(await events(order.id)).toEqual([]);
  });

  it.each([30, 2000])('ровно %i символов — граница включительно', async (length) => {
    const order = await newOrder();
    expect((await cancel(order.id, { reason: 'я'.repeat(length) }, '"v1"')).statusCode).toBe(200);
  });

  it.each(['picked_up', 'delivered'] as const)('из %s отменить нельзя → 409', async (status) => {
    const courier = await newCourier();
    const order = await newOrder(status, courier.id);
    const response = await cancel(order.id, { reason: REASON }, '"v1"');
    expect(response.statusCode).toBe(409);
    expect(problemBody(response)).toMatchObject({
      code: 'TRANSITION_NOT_ALLOWED',
      detail: 'Заказ уже передан курьеру или завершён — отменить нельзя',
    });
  });

  it('уже отменённый заказ повторно → 409', async () => {
    const order = await newOrder('cancelled');
    expect((await cancel(order.id, { reason: REASON }, '"v1"')).statusCode).toBe(409);
  });

  it('причина длиннее 2000 символов → 400', async () => {
    const order = await newOrder();
    expect((await cancel(order.id, { reason: 'я'.repeat(2001) }, '"v1"')).statusCode).toBe(400);
  });

  it('символ NUL в причине → 400, а не 500 от Postgres', async () => {
    const order = await newOrder();
    const response = await cancel(order.id, { reason: `${REASON}\u0000` }, '"v1"');
    expect(response.statusCode).toBe(400);
    expect(problemBody(response).code).toBe('VALIDATION_FAILED');
  });
});

// Параллельные запросы. Какой из двух выполнится первым, не определено, поэтому проверяем
// набор исходов (отсортированный), а не порядок. Сами исходы детерминированы блокировками.
describe('гонки: одновременные запросы', () => {
  const statuses = (responses: { statusCode: number }[]) =>
    responses.map((response) => response.statusCode).sort((a, b) => a - b);

  it('два назначения курьеру с 2 активными доставками: одно 200, другое 409; в итоге ровно 3', async () => {
    const courier = await newCourier();
    await newOrder('ready', courier.id);
    await newOrder('picked_up', courier.id);
    const first = await newOrder('ready');
    const second = await newOrder('ready');

    const responses = await Promise.all([
      setCourier(first.id, courier.id, '"v1"'),
      setCourier(second.id, courier.id, '"v1"'),
    ]);
    expect(statuses(responses)).toEqual([200, 409]);
    expect(await activeDeliveries(courier.id)).toBe(3);
  });

  it('переход в ready и назначение того же курьера одновременно: третье место достаётся одному', async () => {
    const courier = await newCourier();
    await newOrder('ready', courier.id);
    await newOrder('picked_up', courier.id);
    // Оба пути занимают последнее место: свой заказ курьера становится ready…
    const preparing = await newOrder('preparing', courier.id);
    // …и чужой заказ в ready получает этого курьера.
    const ready = await newOrder('ready');

    const responses = await Promise.all([
      transition(preparing.id, 'ready', '"v1"'),
      setCourier(ready.id, courier.id, '"v1"'),
    ]);
    expect(statuses(responses)).toEqual([200, 409]);
    const rejected = responses.find((response) => response.statusCode === 409);
    expect(rejected && problemBody(rejected).code).toBe('COURIER_LIMIT_REACHED');
    expect(await activeDeliveries(courier.id)).toBe(3);
  });

  it('два изменения одного заказа с одной версией: одно 200, другое 412; одна запись audit', async () => {
    const order = await newOrder();
    const responses = await Promise.all([
      transition(order.id, 'accepted', '"v1"'),
      cancel(order.id, { reason: REASON }, '"v1"'),
    ]);
    expect(statuses(responses)).toEqual([200, 412]);
    expect(await events(order.id)).toHaveLength(1);

    // Проигравший получает актуальный заказ, даже если конфликт обнаружен только в UPDATE
    // (compare-and-set), а не при первой проверке версии: оба пути отвечают одинаково.
    const rejected = responses.find((response) => response.statusCode === 412);
    const body = versionConflictProblemSchema.parse(rejected?.json());
    expect(body.current?.version).toBe(2);
    expect(body.lastChange).toMatchObject({ orderVersion: 2, actor: { id: operatorId } });
  });

  it('одновременный обмен курьерами между двумя заказами — без 500 (раньше был deadlock)', async () => {
    const east = await newCourier();
    const west = await newCourier();
    const first = await newOrder('ready', east.id);
    const second = await newOrder('ready', west.id);

    const responses = await Promise.all([
      setCourier(first.id, west.id, '"v1"'),
      setCourier(second.id, east.id, '"v1"'),
    ]);
    expect(statuses(responses)).toEqual([200, 200]);
  });
});

describe('доступ', () => {
  it('изменение без сессии → 401', async () => {
    const order = await newOrder();
    const response = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/transitions`,
      payload: { to: 'accepted' },
      headers: { 'if-match': '"v1"' },
    });
    expect(response.statusCode).toBe(401);
  });
});
