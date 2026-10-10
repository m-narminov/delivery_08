import type { Database } from '../src/db/client';
import { couriers, orderEvents, orders, restaurants } from '../src/db/schema';

// Фабрики тестовых данных: явные значения в тесте, разумные значения по умолчанию здесь.

export async function insertRestaurant(db: Database, name: string) {
  const [row] = await db.insert(restaurants).values({ name }).returning();
  if (!row) throw new Error('restaurant was not inserted');
  return row;
}

export async function insertCourier(db: Database, name: string) {
  const [row] = await db.insert(couriers).values({ name, phone: '+70000000000' }).returning();
  if (!row) throw new Error('courier was not inserted');
  return row;
}

type OrderOverrides = Partial<typeof orders.$inferInsert> & { restaurantId: number };

export async function insertOrder(db: Database, overrides: OrderOverrides) {
  const [row] = await db
    .insert(orders)
    .values({
      customerName: 'Иван Клиентов',
      customerPhone: '+70000000001',
      deliveryAddress: 'г. Москва, ул. Тестовая, д. 1',
      amountMinor: 100_000,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('order was not inserted');
  return row;
}

export async function insertOrderEvent(db: Database, values: typeof orderEvents.$inferInsert) {
  const [row] = await db.insert(orderEvents).values(values).returning();
  if (!row) throw new Error('order event was not inserted');
  return row;
}
