import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { couriers, orderEvents, orders, restaurants } from '../../src/db/schema';
import { createTestDatabase, pgErrorCode, type TestDatabase } from '../db';

// SQLSTATE-коды Postgres: https://www.postgresql.org/docs/current/errcodes-appendix.html
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const STRING_TOO_LONG = '22001';
const INVALID_ENUM_VALUE = '22P02';
const GENERATED_ALWAYS = '428C9';

let testDb: TestDatabase;
let restaurantId: number;
let courierId: number;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const [restaurant] = await testDb.db
    .insert(restaurants)
    .values({ name: 'Тестовый ресторан' })
    .returning();
  const [courier] = await testDb.db
    .insert(couriers)
    .values({ name: 'Тестовый курьер', phone: '+70000000000' })
    .returning();
  if (!restaurant || !courier) throw new Error('fixtures were not inserted');
  restaurantId = restaurant.id;
  courierId = courier.id;
});

afterAll(async () => {
  await testDb.drop();
});

const order = (overrides: Partial<typeof orders.$inferInsert> = {}) => ({
  customerName: 'Иван',
  customerPhone: '+70000000001',
  restaurantId,
  deliveryAddress: 'г. Москва, ул. Тестовая, д. 1',
  amountMinor: 100_000,
  ...overrides,
});

describe('ограничения таблицы orders', () => {
  it('новый заказ по умолчанию в статусе new с версией 1', async () => {
    const [inserted] = await testDb.db.insert(orders).values(order()).returning();
    expect(inserted).toMatchObject({ status: 'new', version: 1, courierId: null });
  });

  it.each(['picked_up', 'delivered'] as const)('%s без курьера нарушает CHECK', async (status) => {
    expect(await pgErrorCode(testDb.db.insert(orders).values(order({ status })))).toBe(
      CHECK_VIOLATION,
    );
  });

  it('picked_up с курьером допустим', async () => {
    expect(
      await pgErrorCode(testDb.db.insert(orders).values(order({ status: 'picked_up', courierId }))),
    ).toBeUndefined();
  });

  it('сумма должна быть положительной', async () => {
    expect(await pgErrorCode(testDb.db.insert(orders).values(order({ amountMinor: 0 })))).toBe(
      CHECK_VIOLATION,
    );
  });

  it('несуществующий ресторан нарушает внешний ключ', async () => {
    expect(
      await pgErrorCode(testDb.db.insert(orders).values(order({ restaurantId: 999_999 }))),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('неизвестный статус отклоняется типом enum', async () => {
    expect(
      await pgErrorCode(
        testDb.db.execute(sql`
          insert into orders (status, customer_name, customer_phone, restaurant_id, delivery_address, amount_minor)
          values ('lost', 'Иван', '+70000000001', ${restaurantId}, 'адрес', 100)
        `),
      ),
    ).toBe(INVALID_ENUM_VALUE);
  });

  it('id нельзя задать вручную (GENERATED ALWAYS)', async () => {
    expect(
      await pgErrorCode(
        testDb.db.execute(sql`insert into restaurants (id, name) values (500, 'x')`),
      ),
    ).toBe(GENERATED_ALWAYS);
  });

  it('колонка поиска вычисляется БД: нижний регистр, ё → е', async () => {
    const [inserted] = await testDb.db
      .insert(orders)
      .values(order({ deliveryAddress: 'г. Москва, ул. КОРОЛЁВА, д. 5' }))
      .returning();
    expect(inserted?.deliveryAddressSearch).toBe('г. москва, ул. королева, д. 5');
  });

  it('колонку поиска нельзя записать вручную', async () => {
    expect(
      await pgErrorCode(
        testDb.db.execute(sql`
          insert into orders (customer_name, customer_phone, restaurant_id, delivery_address, delivery_address_search, amount_minor)
          values ('Иван', '+70000000001', ${restaurantId}, 'адрес', 'другое', 100)
        `),
      ),
    ).toBe(GENERATED_ALWAYS);
  });
});

describe('ограничения таблицы order_events', () => {
  let orderId: number;

  beforeAll(async () => {
    const [inserted] = await testDb.db.insert(orders).values(order()).returning();
    if (!inserted) throw new Error('order was not inserted');
    orderId = inserted.id;
  });

  const event = (overrides: Partial<typeof orderEvents.$inferInsert> = {}) => ({
    orderId,
    action: 'cancelled' as const,
    orderVersion: 1,
    ...overrides,
  });

  it('причина отмены — до 2000 символов', async () => {
    expect(
      await pgErrorCode(testDb.db.insert(orderEvents).values(event({ reason: 'я'.repeat(2000) }))),
    ).toBeUndefined();
    expect(
      await pgErrorCode(
        testDb.db.insert(orderEvents).values(event({ orderVersion: 2, reason: 'я'.repeat(2001) })),
      ),
    ).toBe(STRING_TOO_LONG);
  });

  it('на одну версию заказа — одна запись', async () => {
    await testDb.db.insert(orderEvents).values(event({ orderVersion: 3 }));
    expect(
      await pgErrorCode(testDb.db.insert(orderEvents).values(event({ orderVersion: 3 }))),
    ).toBe(UNIQUE_VIOLATION);
  });
});
