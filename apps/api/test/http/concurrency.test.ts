import { MAX_ACTIVE_DELIVERIES_PER_COURIER, type OrderStatus } from '@foodster/shared';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client';
import { orderEvents, orders } from '../../src/db/schema';
import { SESSION_COOKIE } from '../../src/http/session';
import { createTestApp, insertOperator, loginAs, problemBody, type TestApp } from '../app';
import { insertCourier, insertOrder, insertRestaurant } from '../factories';

// Конкурентность и атомарность на уровне HTTP. Какой из одновременных запросов выиграет,
// не определено, поэтому проверяются исходы и инварианты, а не порядок.

let app: TestApp;
let db: Database;
let close: () => Promise<void>;
let session: string;
let restaurantId: number;

beforeAll(async () => {
  const testApp = await createTestApp();
  ({ app, db, close } = testApp);
  const operator = await insertOperator(db);
  session = await loginAs(app, operator.id);
  restaurantId = (await insertRestaurant(db, 'Пицца')).id;
});

afterAll(async () => {
  await close();
});

let courierCounter = 0;
async function newCourier() {
  courierCounter += 1;
  return insertCourier(db, `Курьер ${courierCounter}`);
}

function newOrder(status: OrderStatus = 'new', courierId: number | null = null) {
  return insertOrder(db, { restaurantId, status, courierId });
}

function send(method: 'POST' | 'PUT', url: string, payload: object, ifMatch: string) {
  return app.inject({
    method,
    url,
    payload,
    headers: { 'if-match': ifMatch },
    cookies: { [SESSION_COOKIE]: session },
  });
}

const transition = (id: number, to: string, ifMatch = '*') =>
  send('POST', `/api/orders/${id}/transitions`, { to }, ifMatch);
const setCourier = (id: number, courierId: number | null, ifMatch = '*') =>
  send('PUT', `/api/orders/${id}/courier`, { courierId }, ifMatch);
const cancel = (id: number, reason?: string, ifMatch = '*') =>
  send('POST', `/api/orders/${id}/cancel`, reason === undefined ? {} : { reason }, ifMatch);

// Сколько раз встретился каждый код ответа: { 200: 3, 409: 3 }.
function countStatuses(responses: { statusCode: number }[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const { statusCode } of responses) counts[statusCode] = (counts[statusCode] ?? 0) + 1;
  return counts;
}

async function activeDeliveries(courierId: number): Promise<number> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(sql`${orders.courierId} = ${courierId} and ${orders.status} in ('ready', 'picked_up')`);
  return rows.length;
}

describe('атомарность: заказ и запись audit — одна транзакция', () => {
  beforeAll(async () => {
    // Функция-сбой для триггеров и триггер: вставка в audit падает по сигналу в причине
    // отмены. У каждого тестового файла своя БД, поэтому триггер не влияет на другие тесты;
    // в этом файле его задевает только причина FAIL_AUDIT.
    await db.execute(sql`
      create function fail_audit() returns trigger language plpgsql as $$
      begin
        raise exception 'audit insert failed (test)';
      end
      $$
    `);
    await db.execute(sql`
      create trigger fail_audit before insert on order_events
      for each row when (new.reason = 'FAIL_AUDIT') execute function fail_audit()
    `);
  });

  it('запись audit не удалась → изменение заказа откатывается, событие не публикуется', async () => {
    const order = await newOrder('preparing');
    const published: number[] = [];
    const unsubscribe = app.orderEvents.subscribe({
      onChange: (event) => published.push(event.orderId),
      onGap: () => undefined,
    });
    try {
      const response = await cancel(order.id, 'FAIL_AUDIT', '"v1"');
      expect(response.statusCode).toBe(500);
      expect(problemBody(response).code).toBe('INTERNAL_ERROR');

      const [stored] = await db.select().from(orders).where(eq(orders.id, order.id));
      expect(stored).toMatchObject({ status: 'preparing', version: 1 });
      expect(await db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id))).toEqual(
        [],
      );
      expect(published).toEqual([]);

      // Без сбоя та же отмена проходит: заказ не остался заблокированным или «полуизменённым».
      expect((await cancel(order.id, 'Клиент передумал', '"v1"')).statusCode).toBe(200);
    } finally {
      unsubscribe();
    }
  });

  // Сбой на вставке выше не отличает «audit в той же транзакции» от «audit в отдельном
  // соединении»: в обоих случаях запись не появится. Здесь сбой — при COMMIT, когда обе
  // записи уже сделаны. Если audit ушёл мимо транзакции, его запись останется без изменения
  // заказа.
  it('транзакция не закоммитилась после обеих записей → нет ни изменения заказа, ни записи audit', async () => {
    const order = await newOrder('preparing');
    // Отложенный (DEFERRED) триггер ограничения срабатывает при COMMIT. Только для этого заказа:
    // id — число из БД, подстановка безопасна.
    await db.execute(sql`
      create constraint trigger fail_commit after update on orders
      deferrable initially deferred
      for each row when (new.id = ${sql.raw(String(order.id))})
      execute function fail_audit()
    `);
    const published: number[] = [];
    const unsubscribe = app.orderEvents.subscribe({
      onChange: (event) => published.push(event.orderId),
      onGap: () => undefined,
    });
    try {
      const response = await transition(order.id, 'ready', '"v1"');
      expect(response.statusCode).toBe(500);
      expect(problemBody(response).code).toBe('INTERNAL_ERROR');
      expect(published).toEqual([]);
      const [stored] = await db.select().from(orders).where(eq(orders.id, order.id));
      expect(stored).toMatchObject({ status: 'preparing', version: 1 });
      expect(await db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id))).toEqual(
        [],
      );
    } finally {
      unsubscribe();
      await db.execute(sql`drop trigger fail_commit on orders`);
    }
  });
});

describe('гонки: много одновременных запросов', () => {
  // Претендентов заметно больше лимита — от лимита и считаем, чтобы тест не потерял смысл,
  // если лимит изменится.
  const contenders = MAX_ACTIVE_DELIVERIES_PER_COURIER + 3;

  it(`${contenders} одновременных назначений свободному курьеру — ровно ${MAX_ACTIVE_DELIVERIES_PER_COURIER} успеха`, async () => {
    const courier = await newCourier();
    const ready = await Promise.all(Array.from({ length: contenders }, () => newOrder('ready')));

    const responses = await Promise.all(
      ready.map((order) => setCourier(order.id, courier.id, '"v1"')),
    );
    expect(countStatuses(responses)).toEqual({
      200: MAX_ACTIVE_DELIVERIES_PER_COURIER,
      409: contenders - MAX_ACTIVE_DELIVERIES_PER_COURIER,
    });
    for (const response of responses.filter((item) => item.statusCode === 409)) {
      expect(problemBody(response).code).toBe('COURIER_LIMIT_REACHED');
    }
    expect(await activeDeliveries(courier.id)).toBe(MAX_ACTIVE_DELIVERIES_PER_COURIER);
  });

  it('пять одновременных изменений одного заказа с одной версией — один успех, четыре 412, одна запись audit', async () => {
    const courier = await newCourier();
    const order = await newOrder('preparing');
    const responses = await Promise.all([
      transition(order.id, 'ready', '"v1"'),
      setCourier(order.id, courier.id, '"v1"'),
      cancel(order.id, 'Отмена', '"v1"'),
      transition(order.id, 'ready', '"v1"'),
      setCourier(order.id, courier.id, '"v1"'),
    ]);
    expect(countStatuses(responses)).toEqual({ 200: 1, 412: 4 });
    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));
    expect(events).toHaveLength(1);
  });
});

describe('выход из конечных статусов через API', () => {
  it.each([
    ['delivered', 'transitions'],
    ['cancelled', 'transitions'],
    ['delivered', 'cancel'],
    ['cancelled', 'cancel'],
  ] as const)('из %s (%s) → 409, заказ не меняется', async (status, endpoint) => {
    const courier = await newCourier();
    const order = await newOrder(status, status === 'delivered' ? courier.id : null);
    const response =
      endpoint === 'cancel'
        ? await cancel(order.id, undefined, '"v1"')
        : await transition(order.id, 'new', '"v1"');
    expect(response.statusCode).toBe(409);
    expect(problemBody(response).code).toBe('TRANSITION_NOT_ALLOWED');
    const [stored] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(stored).toMatchObject({ status, version: 1 });
  });
});

// Смешанная нагрузка: волны одновременных операций с If-Match: * (без проверки версии —
// так одновременных изменений одного заказа больше всего). Исход каждой операции не
// определён, но после каждой волны должны выполняться инварианты данных.
describe('инварианты под смешанной одновременной нагрузкой', () => {
  type Operation = () => Promise<{ statusCode: number; body: string }>;

  async function checkInvariants(
    orderIds: number[],
    courierIds: number[],
    initial: Map<number, { status: OrderStatus; courierId: number | null }>,
  ) {
    const rows = await db.select().from(orders).where(inArray(orders.id, orderIds));
    expect(rows).toHaveLength(orderIds.length);
    const events = await db
      .select()
      .from(orderEvents)
      .where(inArray(orderEvents.orderId, orderIds))
      .orderBy(asc(orderEvents.orderId), asc(orderEvents.orderVersion));

    for (const order of rows) {
      const history = events.filter((event) => event.orderId === order.id);
      // У тестовых заказов версия 1 и нет записи о создании: каждая запись audit — +1 к версии,
      // версии в audit идут подряд без пропусков и повторов.
      expect(history.map((event) => event.orderVersion)).toEqual(
        Array.from({ length: order.version - 1 }, (_, index) => index + 2),
      );
      // Проигрываем историю от начального состояния — должно получиться текущее.
      const start = initial.get(order.id);
      if (!start) throw new Error(`no initial state for order ${order.id}`);
      let { status, courierId } = start;
      for (const event of history) {
        if (event.toStatus !== null) status = event.toStatus;
        if (event.action.startsWith('courier_')) courierId = event.toCourierId;
      }
      expect({ status: order.status, courierId: order.courierId }).toEqual({ status, courierId });
    }
    for (const courierId of courierIds) {
      expect(await activeDeliveries(courierId)).toBeLessThanOrEqual(
        MAX_ACTIVE_DELIVERIES_PER_COURIER,
      );
    }
    // Пары «заказ — версия» всех записей audit: с ними сверяются опубликованные события.
    return events.map((event) => `${event.orderId}:${event.orderVersion}`);
  }

  it('после каждой волны: версии = записи audit, состояние = проигранная история, лимит курьера, событие на каждую запись', async () => {
    const alex = await newCourier();
    const maria = await newCourier();
    const o1 = await newOrder('ready');
    const o2 = await newOrder('ready');
    const o3 = await newOrder('ready');
    const o4 = await newOrder('ready');
    const o5 = await newOrder('preparing', alex.id);
    const o6 = await newOrder('new');
    const all = [o1, o2, o3, o4, o5, o6];
    const initial = new Map(
      all.map((order) => [order.id, { status: order.status, courierId: order.courierId }]),
    );

    const published: string[] = [];
    const unsubscribe = app.orderEvents.subscribe({
      onChange: (event) => published.push(`${event.orderId}:${event.event.orderVersion}`),
      onGap: () => undefined,
    });

    const waves: Operation[][] = [
      // Пять претендентов на три места у Алекса (четыре назначения и переход его заказа в ready)
      // плюс отмена o1 одновременно с его назначением.
      [
        () => setCourier(o1.id, alex.id),
        () => setCourier(o2.id, alex.id),
        () => setCourier(o3.id, alex.id),
        () => setCourier(o4.id, alex.id),
        () => transition(o5.id, 'ready'),
        () => cancel(o1.id),
        () => transition(o6.id, 'accepted'),
      ],
      [
        () => transition(o1.id, 'picked_up'),
        () => setCourier(o2.id, maria.id),
        () => transition(o3.id, 'picked_up'),
        () => cancel(o4.id),
        () => setCourier(o4.id, maria.id),
        () => setCourier(o5.id, maria.id),
        () => transition(o6.id, 'preparing'),
      ],
      [
        () => transition(o1.id, 'delivered'),
        () => transition(o2.id, 'picked_up'),
        () => setCourier(o3.id, null),
        () => transition(o5.id, 'picked_up'),
        () => setCourier(o6.id, alex.id),
        () => cancel(o6.id),
      ],
    ];

    try {
      for (const wave of waves) {
        const responses = await Promise.all(wave.map((operation) => operation()));
        // Ни одной 500: проигравшие получают 409 (правило) или 412 (версия изменилась).
        // При неожиданном коде в сообщении будет тело ответа — видно, что и почему упало.
        for (const response of responses) {
          expect([200, 409, 412], response.body).toContain(response.statusCode);
        }
        const auditRecords = await checkInvariants(
          all.map((order) => order.id),
          [alex.id, maria.id],
          initial,
        );
        // Событие публикуется после коммита, но до ответа, а без Valkey — синхронно: к этому
        // моменту ровно по событию на каждую запись audit, один к одному.
        expect([...published].sort()).toEqual([...auditRecords].sort());
      }
    } finally {
      unsubscribe();
    }
  });
});
