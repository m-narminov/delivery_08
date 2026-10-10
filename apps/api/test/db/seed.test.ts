import { MAX_ACTIVE_DELIVERIES_PER_COURIER } from '@foodster/shared';
import { count, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../../src/auth/password';
import { couriers, operators, orderEvents, orders, restaurants } from '../../src/db/schema';
import { seedIfEmpty } from '../../src/db/seed';
import { SEED_COUNTS } from '../../src/db/seed-data';
import { createTestDatabase, type TestDatabase } from '../db';

const PASSWORD = 'test-password';

describe('seedIfEmpty', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.drop();
  });

  async function countRows(table: PgTable): Promise<number> {
    const [row] = await testDb.db.select({ value: count() }).from(table);
    return row?.value ?? 0;
  }

  it('засевает пустую БД', async () => {
    expect(await seedIfEmpty(testDb.db, { operatorPassword: PASSWORD })).toBe('seeded');
    expect(await countRows(restaurants)).toBe(SEED_COUNTS.restaurants);
    expect(await countRows(couriers)).toBe(SEED_COUNTS.couriers);
    expect(await countRows(operators)).toBe(SEED_COUNTS.operators);
    expect(await countRows(orders)).toBe(SEED_COUNTS.orders);
  });

  it('повторный запуск ничего не меняет', async () => {
    expect(await seedIfEmpty(testDb.db, { operatorPassword: PASSWORD })).toBe('skipped');
    expect(await countRows(orders)).toBe(SEED_COUNTS.orders);
  });

  it('операторы входят с заданным паролем', async () => {
    const [operator] = await testDb.db.select().from(operators).limit(1);
    expect(operator).toBeDefined();
    expect(await verifyPassword(PASSWORD, operator?.passwordHash ?? '')).toBe(true);
  });

  it('в БД у курьера не больше 3 активных доставок', async () => {
    const { rows } = await testDb.pool.query<{ courier_id: string; active: string }>(`
      SELECT courier_id, count(*) AS active
      FROM orders
      WHERE status IN ('ready', 'picked_up') AND courier_id IS NOT NULL
      GROUP BY courier_id
      HAVING count(*) > ${MAX_ACTIVE_DELIVERIES_PER_COURIER}
    `);
    expect(rows).toEqual([]);
  });

  it('version каждого заказа совпадает с числом записей audit', async () => {
    const { rows } = await testDb.pool.query<{ id: string }>(`
      SELECT o.id
      FROM orders o
      LEFT JOIN (SELECT order_id, count(*) AS events FROM order_events GROUP BY order_id) e
        ON e.order_id = o.id
      WHERE e.events IS DISTINCT FROM o.version
    `);
    expect(rows).toEqual([]);
  });

  it('статус заказа совпадает с последним статусом в audit', async () => {
    const { rows } = await testDb.pool.query<{ id: string }>(`
      SELECT o.id
      FROM orders o
      CROSS JOIN LATERAL (
        SELECT to_status FROM order_events e
        WHERE e.order_id = o.id AND e.to_status IS NOT NULL
        ORDER BY e.order_version DESC
        LIMIT 1
      ) last
      WHERE last.to_status <> o.status
    `);
    expect(rows).toEqual([]);
  });

  it('у каждого заказа есть запись audit о создании', async () => {
    const [row] = await testDb.db
      .select({ value: count() })
      .from(orderEvents)
      .where(sql`${orderEvents.action} = 'created' and ${orderEvents.orderVersion} = 1`);
    expect(row?.value).toBe(SEED_COUNTS.orders);
  });
});

describe('seedIfEmpty при одновременном запуске', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.drop();
  });

  it('засевает ровно один из двух параллельных запусков (advisory lock)', async () => {
    const results = await Promise.all([
      seedIfEmpty(testDb.db, { operatorPassword: PASSWORD }),
      seedIfEmpty(testDb.db, { operatorPassword: PASSWORD }),
    ]);
    expect(results.toSorted()).toEqual(['seeded', 'skipped']);
    const [row] = await testDb.db.select({ value: count() }).from(orders);
    expect(row?.value).toBe(SEED_COUNTS.orders);
  });
});
