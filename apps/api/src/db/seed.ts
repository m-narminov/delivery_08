import { sql } from 'drizzle-orm';
import { hashPassword } from '../auth/password';
import type { Database } from './client';
import { couriers, operators, orderEvents, orders, restaurants } from './schema';
import { generateSeedData } from './seed-data';

// Произвольный ключ advisory lock: два одновременных запуска seed не засеют базу дважды.
const SEED_LOCK_KEY = 70_011;

function byIndex(ids: readonly number[], index: number): number {
  const id = ids[index];
  if (id === undefined) throw new Error(`Seed reference ${index} is out of range`);
  return id;
}

function optionalByIndex(ids: readonly number[], index: number | null): number | null {
  return index === null ? null : byIndex(ids, index);
}

// Засевает БД, только если она пустая. Повторный запуск безопасен.
export async function seedIfEmpty(
  db: Database,
  options: { operatorPassword: string; now?: Date },
): Promise<'seeded' | 'skipped'> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK_KEY})`);
    const existing = await tx.select({ id: operators.id }).from(operators).limit(1);
    if (existing.length > 0) return 'skipped';

    const data = generateSeedData(options.now ?? new Date());
    // Один хеш на всех: пароль общий (демо-стенд), а scrypt намеренно медленный.
    const passwordHash = await hashPassword(options.operatorPassword);

    // Сопоставление индекс → id: любая перестановка id сохранила бы инварианты seed,
    // так что порядок строк в RETURNING здесь не критичен.
    const restaurantIds = (
      await tx.insert(restaurants).values(data.restaurants).returning({ id: restaurants.id })
    ).map((row) => row.id);
    const courierIds = (
      await tx.insert(couriers).values(data.couriers).returning({ id: couriers.id })
    ).map((row) => row.id);
    const operatorIds = (
      await tx
        .insert(operators)
        .values(data.operators.map((operator) => ({ ...operator, passwordHash })))
        .returning({ id: operators.id })
    ).map((row) => row.id);

    for (const order of data.orders) {
      const [inserted] = await tx
        .insert(orders)
        .values({
          status: order.status,
          restaurantId: byIndex(restaurantIds, order.restaurant),
          courierId: optionalByIndex(courierIds, order.courier),
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          deliveryAddress: order.deliveryAddress,
          amountMinor: order.amountMinor,
          version: order.version,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        })
        .returning({ id: orders.id });
      if (!inserted) throw new Error('Order insert returned no row');

      await tx.insert(orderEvents).values(
        order.events.map((event, index) => ({
          orderId: inserted.id,
          action: event.action,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          fromCourierId: optionalByIndex(courierIds, event.fromCourier),
          toCourierId: optionalByIndex(courierIds, event.toCourier),
          reason: event.reason,
          actorId: optionalByIndex(operatorIds, event.actor),
          orderVersion: index + 1,
          createdAt: event.at,
        })),
      );
    }
    return 'seeded';
  });
}
