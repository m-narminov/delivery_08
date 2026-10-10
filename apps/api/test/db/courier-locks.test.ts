import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client';
import {
  applyOrderChange,
  insertOrderEvent,
  lockCourier,
} from '../../src/modules/orders/orders.repository';
import { createTestDatabase, type TestDatabase } from '../db';
import { insertCourier, insertOrder, insertRestaurant } from '../factories';

// Блокировки на уровне репозитория: две транзакции идут строго по заданному чередованию,
// шаги синхронизируются через Promise.withResolvers — результат не зависит от удачного тайминга.

// pid серверного процесса Postgres, который обслуживает это соединение (транзакцию).
async function backendPid(tx: Pick<Database, 'execute'>): Promise<number> {
  const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
  const pid = rows[0]?.pid;
  if (pid === undefined) throw new Error('pg_backend_pid() returned no row');
  return pid;
}

// Ждёт, пока Postgres покажет: процесс waiter заблокирован процессом holder (pg_blocking_pids).
// Это факт из самой базы, а не догадка по таймингу. Если waiter получил блокировку, не дожидаясь
// holder, — ошибка сразу; если не случилось ни того ни другого — таймаут Vitest.
async function waitUntilBlocked(
  db: Database,
  waiter: number,
  holder: number,
  acquired: () => boolean,
): Promise<void> {
  for (;;) {
    if (acquired()) throw new Error('the waiter acquired the lock without waiting');
    const { rows } = await db.execute<{ blocked: boolean }>(
      sql`select ${holder}::int = any(pg_blocking_pids(${waiter}::int)) as blocked`,
    );
    if (rows[0]?.blocked) return;
    await sleep(10);
  }
}

let testDb: TestDatabase;
let restaurantId: number;

beforeAll(async () => {
  testDb = await createTestDatabase();
  restaurantId = (await insertRestaurant(testDb.db, 'Пицца')).id;
});

afterAll(async () => {
  await testDb.drop();
});

describe('блокировка курьера', () => {
  it('снятие курьера и переход в ready одного заказа одновременно: без deadlock, второй получает конфликт версии', async () => {
    const { db } = testDb;
    const courier = await insertCourier(db, 'Курьер C1');
    const order = await insertOrder(db, {
      restaurantId,
      status: 'preparing',
      courierId: courier.id,
    });
    const t2Locked = Promise.withResolvers<void>();
    const t1Changed = Promise.withResolvers<void>();

    // T2 — переход preparing → ready: сначала блокирует курьера (проверка лимита)…
    const t2 = db.transaction(async (tx) => {
      await lockCourier(tx, courier.id);
      t2Locked.resolve();
      await t1Changed.promise;
      // …потом пишет заказ. Строку держит T1 — ждём; после коммита T1 WHERE перепроверяется.
      return applyOrderChange(tx, order.id, 1, { status: 'ready' });
    });

    // T1 — снятие курьера: пишет заказ, затем запись audit с from_courier_id = C1.
    const t1 = db.transaction(async (tx) => {
      await t2Locked.promise;
      const version = await applyOrderChange(tx, order.id, 1, { courierId: null });
      if (version === undefined) throw new Error('T1 should win the compare-and-set');
      t1Changed.resolve();
      // Проверка внешнего ключа берёт FOR KEY SHARE на строку курьера. Пока lockCourier брал
      // FOR UPDATE, здесь T1 ждал T2, а T2 ждал T1 — deadlock, одна транзакция падала (40P01).
      await insertOrderEvent(tx, {
        orderId: order.id,
        action: 'courier_unassigned',
        fromCourierId: courier.id,
        orderVersion: version,
      });
      return version;
    });

    const [t1Version, t2Version] = await Promise.all([t1, t2]);
    expect(t1Version).toBe(2);
    // Compare-and-set у T2 не прошёл: версия уже не 1. В API это ответ 412.
    expect(t2Version).toBeUndefined();
  });

  it('две блокировки одного курьера по-прежнему идут по очереди — на этом держится лимит', async () => {
    const { db } = testDb;
    const courier = await insertCourier(db, 'Курьер C2');
    const firstLocked = Promise.withResolvers<number>();
    const secondStarted = Promise.withResolvers<number>();
    const releaseFirst = Promise.withResolvers<void>();
    let secondAcquired = false;

    const first = db.transaction(async (tx) => {
      const pid = await backendPid(tx);
      await lockCourier(tx, courier.id);
      firstLocked.resolve(pid);
      await releaseFirst.promise;
    });
    const firstPid = await firstLocked.promise;

    const second = db.transaction(async (tx) => {
      secondStarted.resolve(await backendPid(tx));
      await lockCourier(tx, courier.id);
      secondAcquired = true;
    });

    // Вторая транзакция стоит в очереди за первой: это видно в самой базе.
    await waitUntilBlocked(db, await secondStarted.promise, firstPid, () => secondAcquired);
    expect(secondAcquired).toBe(false);

    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(secondAcquired).toBe(true);
  });
});
