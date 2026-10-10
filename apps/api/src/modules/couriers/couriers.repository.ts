import { ACTIVE_DELIVERY_STATUSES, type Courier } from '@foodster/shared';
import { asc, count, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { couriers, orders } from '../../db/schema';

export type CourierProfile = Omit<Courier, 'activeDeliveries'>;

// Справочные данные курьеров — меняются редко, их можно кэшировать.
export async function listCourierProfiles(db: Database): Promise<CourierProfile[]> {
  return db
    .select({ id: couriers.id, name: couriers.name, phone: couriers.phone })
    .from(couriers)
    .orderBy(asc(couriers.name), asc(couriers.id));
}

// Сколько активных доставок у каждого курьера — меняется с каждым заказом, всегда из БД.
// Курьеров без активных заказов здесь нет: для них 0.
export async function countActiveDeliveriesByCourier(db: Database): Promise<Map<number, number>> {
  const rows = await db
    .select({ courierId: orders.courierId, value: count() })
    .from(orders)
    .where(inArray(orders.status, [...ACTIVE_DELIVERY_STATUSES]))
    .groupBy(orders.courierId);
  const counts = new Map<number, number>();
  for (const { courierId, value } of rows) {
    if (courierId !== null) counts.set(courierId, value);
  }
  return counts;
}
