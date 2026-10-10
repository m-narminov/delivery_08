import { searchVariants, type OrderListQuery, type OrderSortOption } from '@foodster/shared';
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client';
import { couriers, operators, orderEvents, orders, restaurants } from '../../db/schema';

// Порог word_similarity для поиска по адресу. По умолчанию в pg_trgm 0.6, а одна опечатка
// («садвая» против «садовая») даёт 0.5 — замерено на нашей БД.
export const SEARCH_SIMILARITY_THRESHOLD = 0.4;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

// Заказ вместе с названием ресторана и именем курьера — одним запросом (JOIN), без N+1.
function selectOrders(db: Executor) {
  return db
    .select({
      id: orders.id,
      status: orders.status,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      deliveryAddress: orders.deliveryAddress,
      amountMinor: orders.amountMinor,
      version: orders.version,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
      courierId: couriers.id,
      courierName: couriers.name,
    })
    .from(orders)
    .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
    .leftJoin(couriers, eq(orders.courierId, couriers.id));
}

export type OrderRow = Awaited<ReturnType<typeof selectOrders>>[number];

// Второй ключ сортировки — id: при равных значениях порядок стабилен между страницами.
const SORTS = {
  'createdAt:desc': [desc(orders.createdAt), desc(orders.id)],
  'createdAt:asc': [asc(orders.createdAt), asc(orders.id)],
  'updatedAt:desc': [desc(orders.updatedAt), desc(orders.id)],
  'updatedAt:asc': [asc(orders.updatedAt), asc(orders.id)],
  'amount:desc': [desc(orders.amountMinor), desc(orders.id)],
  'amount:asc': [asc(orders.amountMinor), asc(orders.id)],
} satisfies Record<OrderSortOption, SQL[]>;

export async function listOrders(
  db: Database,
  query: OrderListQuery,
): Promise<{ rows: OrderRow[]; total: number }> {
  // Repeatable read: total и страница считаются по одному снимку данных и не расходятся,
  // даже если между двумя запросами кто-то изменил заказы.
  return db.transaction(
    async (tx) => {
      const conditions: SQL[] = [];
      if (query.status) conditions.push(inArray(orders.status, query.status));
      if (query.restaurantId !== undefined) {
        conditions.push(eq(orders.restaurantId, query.restaurantId));
      }

      const variants = query.q ? searchVariants(query.q) : [];
      let relevance: SQL | undefined;
      if (variants.length > 0) {
        // Порог действует только до конца этой транзакции (третий аргумент true).
        await tx.execute(
          sql`select set_config('pg_trgm.word_similarity_threshold', ${String(SEARCH_SIMILARITY_THRESHOLD)}, true)`,
        );
        // Оператор <% использует GIN-индекс по delivery_address_search.
        const match = or(...variants.map((v) => sql`${v} <% ${orders.deliveryAddressSearch}`));
        if (match) conditions.push(match);
        relevance = sql`greatest(${sql.join(
          variants.map((v) => sql`word_similarity(${v}, ${orders.deliveryAddressSearch})`),
          sql`, `,
        )})`;
      }
      const where = and(...conditions);

      const [counted] = await tx.select({ total: count() }).from(orders).where(where);
      const rows = await selectOrders(tx)
        .where(where)
        // При поиске сначала самые похожие адреса, затем выбранная сортировка.
        .orderBy(...(relevance ? [desc(relevance)] : []), ...SORTS[query.sort])
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      return { rows, total: counted?.total ?? 0 };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

export async function findOrderById(db: Executor, id: number): Promise<OrderRow | undefined> {
  const [row] = await selectOrders(db).where(eq(orders.id, id)).limit(1);
  return row;
}

export async function orderExists(db: Executor, id: number): Promise<boolean> {
  const [row] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, id)).limit(1);
  return row !== undefined;
}

const fromCourier = alias(couriers, 'from_courier');
const toCourier = alias(couriers, 'to_courier');

function selectOrderEvents(db: Executor) {
  return db
    .select({
      id: orderEvents.id,
      action: orderEvents.action,
      fromStatus: orderEvents.fromStatus,
      toStatus: orderEvents.toStatus,
      fromCourierId: fromCourier.id,
      fromCourierName: fromCourier.name,
      toCourierId: toCourier.id,
      toCourierName: toCourier.name,
      reason: orderEvents.reason,
      actorId: operators.id,
      actorName: operators.name,
      orderVersion: orderEvents.orderVersion,
      createdAt: orderEvents.createdAt,
    })
    .from(orderEvents)
    .leftJoin(fromCourier, eq(orderEvents.fromCourierId, fromCourier.id))
    .leftJoin(toCourier, eq(orderEvents.toCourierId, toCourier.id))
    .leftJoin(operators, eq(orderEvents.actorId, operators.id));
}

export type OrderEventRow = Awaited<ReturnType<typeof selectOrderEvents>>[number];

export async function listOrderEvents(db: Executor, orderId: number): Promise<OrderEventRow[]> {
  return selectOrderEvents(db)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.orderVersion));
}
