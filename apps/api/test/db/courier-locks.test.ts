import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyOrderChange,
  insertOrderEvent,
  lockCourier,
} from '../../src/modules/orders/orders.repository';
import { createTestDatabase, type TestDatabase } from '../db';
import { insertCourier, insertOrder, insertRestaurant } from '../factories';

// Блокировки на уровне репозитория: две транзакции идут строго по заданному чередованию,
// шаги синхронизируются через Promise.withResolvers — результат не зависит от удачного тайминга.

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
    const order = await insertOrder(db, { restaurantId, status: 'preparing', courierId: courier.id });
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
    const firstLocked = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    let secondAcquired = false;

    const first = db.transaction(async (tx) => {
      await lockCourier(tx, courier.id);
      firstLocked.resolve();
      await releaseFirst.promise;
    });
    await firstLocked.promise;

    const second = db.transaction(async (tx) => {
      await lockCourier(tx, courier.id);
      secondAcquired = true;
    });

    // Пока первая транзакция открыта, вторая ждёт на строке курьера.
    await sleep(200);
    expect(secondAcquired).toBe(false);

    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(secondAcquired).toBe(true);
  });
});
