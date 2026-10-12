import {
  ACTIVE_DELIVERY_STATUSES,
  searchVariants,
  type OrderListQuery,
  type OrderSortOption,
} from '@foodster/shared';
import { and, asc, count, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client';
import { couriers, operators, orderEvents, orders, restaurants } from '../../db/schema';

// Порог word_similarity для поиска по адресу. По умолчанию в pg_trgm 0.6, а одна опечатка в слове
// даёт от 0.25–0.33 (слова из 3–5 букв) до 0.89 — замер на словах наших адресов; «садвая» → «Садовая»
// 0.5, «ленена» → «Ленина» 0.43. При 0.5 терялась примерно половина опечаток в словах из 4–6
// букв, поэтому порог 0.4. Цена — похожие, но другие улицы («мостовая» → «Трактовая»
// 0.44), поэтому точные совпадения стоят выше похожих (orderByFor). И короткие запросы: «г. Москва»
// есть в каждом русском адресе, и «мост» (0.6 к «москва») находит их все.
const SEARCH_SIMILARITY_THRESHOLD = 0.4;

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

// Заказ вместе с названием ресторана и именем курьера — одним запросом (JOIN), без N+1.
const orderFields = {
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
};

function selectOrders(db: Executor) {
  return db
    .select(orderFields)
    .from(orders)
    .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
    .leftJoin(couriers, eq(orders.courierId, couriers.id));
}

export type OrderRow = Awaited<ReturnType<typeof selectOrders>>[number];

// Ключ сортировки и направление для id. id — последний ключ: при равных значениях порядок
// стабилен между страницами.
const SORTS = {
  'createdAt:desc': { key: desc(orders.createdAt), id: desc(orders.id) },
  'createdAt:asc': { key: asc(orders.createdAt), id: asc(orders.id) },
  'updatedAt:desc': { key: desc(orders.updatedAt), id: desc(orders.id) },
  'updatedAt:asc': { key: asc(orders.updatedAt), id: asc(orders.id) },
  'amount:desc': { key: desc(orders.amountMinor), id: desc(orders.id) },
  'amount:asc': { key: asc(orders.amountMinor), id: asc(orders.id) },
} satisfies Record<OrderSortOption, { key: SQL; id: SQL }>;

// Порядок при поиске (search есть, только когда идёт поиск):
// 1) точные совпадения — каждое слово запроса есть в адресе (см. exactMatch) — выше похожих
//    (с опечаткой);
// 2) внутри каждой группы — выбранная сортировка (по умолчанию новые сверху);
// 3) при равенстве по ней — более похожий адрес; последним — id.
// Без первого правила свежий адрес «ул. Трактовая» стоял выше точного «ул. Мостовая».
interface SearchOrder {
  // Нет, если ни в одном варианте запроса нет слов (одни знаки, «,»): точных совпадений нет.
  exact: SQL | undefined;
  relevance: SQL;
}

function orderByFor(sort: OrderSortOption, search: SearchOrder | undefined): SQL[] {
  const { key, id } = SORTS[sort];
  if (!search) return [key, id];
  // Константа (false) в ORDER BY Postgres не принимает — поэтому без exact, когда слов нет.
  return [...(search.exact ? [desc(search.exact)] : []), key, desc(search.relevance), id];
}

// Слова запроса — по любым знакам, а не только по пробелу: «садовая, 5» и «д.15» — два слова.
const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;

// Слово есть в адресе. Число — целиком: «5» не совпадает с «д. 15» или «кв. 105». Остальное —
// подстрокой (strpos — без шаблонов, так что % и _ в запросе ничего не значат); «садов» найдёт
// и «Садовая», и «Садово-Кудринская». В регулярное выражение попадают только цифры.
function containsWord(word: string): SQL {
  return /^\d+$/.test(word)
    ? sql`${orders.deliveryAddressSearch} ~ ${`(^|[^0-9])${word}([^0-9]|$)`}`
    : sql`strpos(${orders.deliveryAddressSearch}, ${word}) > 0`;
}

// Точное совпадение: все слова какого-нибудь варианта запроса (раскладка, транслит) есть в адресе.
function exactMatch(variants: string[]): SQL | undefined {
  const perVariant = variants
    .map((variant) => variant.split(WORD_SEPARATOR).filter(Boolean))
    .filter((words) => words.length > 0)
    .map((words) => and(...words.map(containsWord)));
  return or(...perVariant);
}

export async function listOrders(
  db: Database,
  query: OrderListQuery,
): Promise<{ rows: OrderRow[]; total: number }> {
  const conditions: SQL[] = [];
  if (query.status) conditions.push(inArray(orders.status, query.status));
  if (query.restaurantId !== undefined) {
    conditions.push(eq(orders.restaurantId, query.restaurantId));
  }

  const variants = query.q ? searchVariants(query.q) : [];
  if (variants.length === 0) return listPage(db, query, and(...conditions), undefined);

  // Оператор <% использует GIN-индекс по delivery_address_search.
  const match = or(...variants.map((v) => sql`${v} <% ${orders.deliveryAddressSearch}`));
  if (match) conditions.push(match);
  const search: SearchOrder = {
    exact: exactMatch(variants),
    relevance: sql`greatest(${sql.join(
      variants.map((v) => sql`word_similarity(${v}, ${orders.deliveryAddressSearch})`),
      sql`, `,
    )})`,
  };
  // Транзакция — только ради порога: set_config(…, true) действует до её конца.
  return db.transaction(
    async (tx) => {
      await tx.execute(
        sql`select set_config('pg_trgm.word_similarity_threshold', ${String(SEARCH_SIMILARITY_THRESHOLD)}, true)`,
      );
      return listPage(tx, query, and(...conditions), search);
    },
    { accessMode: 'read only' },
  );
}

// Страница и общее число — одним SQL-запросом: total считается подзапросом, а один запрос
// видит один снимок данных, так что total и страница не расходятся. Подзапрос не связан с
// внешним (внутренний orders заслоняет внешний), Postgres выполняет его один раз. Условия
// фильтров — только по orders; фильтр по ресторану или курьеру через JOIN связал бы подзапрос
// с внешним запросом, и total посчитался бы неверно.
async function listPage(
  db: Executor,
  query: OrderListQuery,
  where: SQL | undefined,
  search: SearchOrder | undefined,
): Promise<{ rows: OrderRow[]; total: number }> {
  const total = sql<number>`(select count(*) from ${orders} where ${where ?? sql`true`})`.mapWith(
    Number,
  );
  const rows = await db
    .select({ ...orderFields, total })
    .from(orders)
    .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
    .leftJoin(couriers, eq(orders.courierId, couriers.id))
    .where(where)
    .orderBy(...orderByFor(query.sort, search))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const [first] = rows;
  if (first) return { rows, total: first.total };
  // Пустая страница: за последней страницей (или ничего не найдено) total отдельным запросом.
  if (query.page === 1) return { rows, total: 0 };
  const [counted] = await db.select({ total: count() }).from(orders).where(where);
  return { rows, total: counted?.total ?? 0 };
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

export async function findLastOrderEvent(
  db: Executor,
  orderId: number,
): Promise<OrderEventRow | undefined> {
  const [row] = await selectOrderEvents(db)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(desc(orderEvents.orderVersion))
    .limit(1);
  return row;
}

// --- Запись: вызывается только внутри транзакции ---

// Блокирует строку курьера до конца транзакции. Все, кто меняет активные доставки этого
// курьера, выстраиваются в очередь — так лимит нельзя обойти гонкой.
//
// Именно FOR NO KEY UPDATE, а не FOR UPDATE: проверка внешнего ключа при вставке в order_events
// (from/to_courier_id) берёт на строку курьера FOR KEY SHARE. С FOR UPDATE она конфликтует,
// и две транзакции, меняющие курьеров, могли взаимно заблокироваться (deadlock → 500).
// FOR NO KEY UPDATE с FOR KEY SHARE не конфликтует, а сам с собой — да: очередь сохраняется.
export async function lockCourier(
  tx: Transaction,
  courierId: number,
): Promise<{ id: number; name: string } | undefined> {
  const [row] = await tx
    .select({ id: couriers.id, name: couriers.name })
    .from(couriers)
    .where(eq(couriers.id, courierId))
    .for('no key update');
  return row;
}

// Активные доставки курьера, кроме заказа, который сейчас меняем.
export async function countActiveDeliveries(
  tx: Transaction,
  courierId: number,
  exceptOrderId: number,
): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(orders)
    .where(
      and(
        eq(orders.courierId, courierId),
        inArray(orders.status, [...ACTIVE_DELIVERY_STATUSES]),
        ne(orders.id, exceptOrderId),
      ),
    );
  return row?.value ?? 0;
}

export type OrderChange = Partial<Pick<typeof orders.$inferInsert, 'status' | 'courierId'>>;

// Compare-and-set: изменение применится, только если версия всё ещё та, что мы прочитали.
// Возвращает новую версию или undefined, если заказ уже успел измениться.
export async function applyOrderChange(
  tx: Transaction,
  orderId: number,
  expectedVersion: number,
  change: OrderChange,
): Promise<number | undefined> {
  const [row] = await tx
    .update(orders)
    .set({ ...change, version: sql`${orders.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(orders.id, orderId), eq(orders.version, expectedVersion)))
    .returning({ version: orders.version });
  return row?.version;
}

export async function insertOrderEvent(
  tx: Transaction,
  event: typeof orderEvents.$inferInsert,
): Promise<void> {
  await tx.insert(orderEvents).values(event);
}
