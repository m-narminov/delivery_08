import { CANCEL_REASON_MAX_LENGTH, ORDER_EVENT_ACTIONS, ORDER_STATUSES } from '@foodster/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

// Все id — bigint identity, в JS — number (почему: docs/learning/ids-bigint.md).
const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const reference = (name: string) => bigint(name, { mode: 'number' });
const timestampTz = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const orderStatus = pgEnum('order_status', ORDER_STATUSES);
export const orderEventAction = pgEnum('order_event_action', ORDER_EVENT_ACTIONS);

export const restaurants = pgTable('restaurants', {
  id: id(),
  name: text('name').notNull(),
});

export const couriers = pgTable('couriers', {
  id: id(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
});

export const operators = pgTable('operators', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
});

export const orders = pgTable(
  'orders',
  {
    id: id(),
    status: orderStatus('status').notNull().default('new'),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    restaurantId: reference('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    courierId: reference('courier_id').references(() => couriers.id),
    deliveryAddress: text('delivery_address').notNull(),
    // Адрес для поиска: нижний регистр и ё → е (как normalizeSearchText в shared).
    // Колонку вычисляет и хранит сама БД (GENERATED … STORED), приложение её не пишет.
    deliveryAddressSearch: text('delivery_address_search')
      .notNull()
      .generatedAlwaysAs(sql`translate(lower(delivery_address), 'ё', 'е')`),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestampTz('created_at'),
    updatedAt: timestampTz('updated_at'),
  },
  (t) => [
    // Последняя линия защиты: те же правила проверяет API, но БД не даст их нарушить никому.
    check(
      'orders_courier_required',
      sql`${t.status} not in ('picked_up', 'delivered') or ${t.courierId} is not null`,
    ),
    check('orders_amount_positive', sql`${t.amountMinor} > 0`),
    check('orders_version_positive', sql`${t.version} > 0`),
    // Список заказов: сортировка по умолчанию и фильтры по статусу/ресторану.
    // NULLS FIRST — как у ORDER BY … DESC в Postgres, иначе индекс не подойдёт для сортировки.
    index('orders_created_at_idx').on(t.createdAt.desc().nullsFirst()),
    index('orders_status_created_at_idx').on(t.status, t.createdAt.desc().nullsFirst()),
    index('orders_restaurant_created_at_idx').on(t.restaurantId, t.createdAt.desc().nullsFirst()),
    // Подсчёт активных доставок курьера: в индекс попадают только ready/picked_up.
    index('orders_courier_active_idx')
      .on(t.courierId)
      .where(sql`${t.status} in ('ready', 'picked_up')`),
    // Поиск по адресу с опечатками (pg_trgm) — по нормализованной колонке.
    index('orders_delivery_address_search_trgm_idx').using(
      'gin',
      t.deliveryAddressSearch.op('gin_trgm_ops'),
    ),
  ],
);

export const orderEvents = pgTable(
  'order_events',
  {
    id: id(),
    orderId: reference('order_id')
      .notNull()
      .references(() => orders.id),
    action: orderEventAction('action').notNull(),
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status'),
    fromCourierId: reference('from_courier_id').references(() => couriers.id),
    toCourierId: reference('to_courier_id').references(() => couriers.id),
    reason: varchar('reason', { length: CANCEL_REASON_MAX_LENGTH }),
    // null — действие не оператора (заказ создан клиентским приложением).
    actorId: reference('actor_id').references(() => operators.id),
    orderVersion: integer('order_version').notNull(),
    createdAt: timestampTz('created_at'),
  },
  (t) => [
    // Каждое изменение заказа повышает version ровно на 1 и пишет ровно одну запись.
    // Уникальный индекс заодно ускоряет выборку истории заказа.
    unique('order_events_order_version_unique').on(t.orderId, t.orderVersion),
  ],
);
