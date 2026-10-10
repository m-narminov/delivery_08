import { z } from 'zod';
import { CANCEL_REASON_MAX_LENGTH } from './order-rules';
import { ORDER_EVENT_ACTIONS } from './order-events';
import { ORDER_STATUSES } from './order-status';

export const orderStatusSchema = z.enum(ORDER_STATUSES);

// Всё, что приходит в URL, — строки, поэтому для path и query нужен coerce.
export const idParamSchema = z.coerce.number().int().positive();

const idSchema = z.number().int().positive();

// Postgres не может сохранить или сравнить текст с символом NUL (\u0000): запрос падает с ошибкой
// кодировки, и клиент получил бы 500. Такой текст — ошибка клиента, отсекаем его при проверке.
function withoutNul(value: string): boolean {
  return !value.includes('\u0000');
}
const NUL_MESSAGE = 'Текст содержит недопустимый символ NUL';

export const ORDER_SORT_OPTIONS = [
  'createdAt:desc',
  'createdAt:asc',
  'updatedAt:desc',
  'updatedAt:asc',
  'amount:desc',
  'amount:asc',
] as const;

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
export const SEARCH_QUERY_MAX_LENGTH = 200;

export const orderListQuerySchema = z.object({
  // ?status=new,ready → ['new', 'ready']; пустой ?status= равнозначен отсутствию фильтра.
  status: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(orderStatusSchema))
    .transform((list) => (list.length > 0 ? list : undefined))
    .optional(),
  restaurantId: idParamSchema.optional(),
  // Пустой поиск (?q=) равнозначен отсутствию поиска.
  q: z
    .string()
    .refine(withoutNul, NUL_MESSAGE)
    .trim()
    .max(SEARCH_QUERY_MAX_LENGTH)
    .transform((value) => value || undefined)
    .optional(),
  sort: z.enum(ORDER_SORT_OPTIONS).default('createdAt:desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

// Отмена — отдельный эндпоинт с причиной, поэтому через переходы её не делаем.
export const transitionBodySchema = z.object({
  to: orderStatusSchema.exclude(['cancelled']),
});

export const courierBodySchema = z.object({
  courierId: idSchema.nullable(),
});

export const cancelBodySchema = z.object({
  // Пустая причина хранится как NULL. JS считает длину в UTF-16 единицах, а varchar(2000)
  // в Postgres — в символах, которых не больше. Прошедшее проверку всегда влезет в БД.
  reason: z
    .string()
    .refine(withoutNul, NUL_MESSAGE)
    .trim()
    .max(CANCEL_REASON_MAX_LENGTH)
    .optional()
    .transform((value) => value || null),
});

export const loginBodySchema = z.object({
  operatorId: idSchema,
  password: z.string().min(1).max(200),
});

// Ответы API. Пароль и его хеш в DTO не входят никогда.
export const operatorSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
});

// Для выпадающего списка на экране входа: только id и имя.
export const operatorOptionSchema = operatorSchema.pick({ id: true, name: true });

export const sessionSchema = z.object({
  operator: operatorSchema,
});

// Справочники.
export const referenceSchema = z.object({ id: idSchema, name: z.string() });

export const restaurantSchema = referenceSchema;

export const courierSchema = referenceSchema.extend({
  phone: z.string(),
  // Сколько заказов курьера сейчас в ready/picked_up — для выбора курьера с учётом лимита.
  activeDeliveries: z.number().int().nonnegative(),
});

// Время — строка ISO 8601 в UTC (Date.toISOString()).
const timestampSchema = z.iso.datetime();

export const orderSchema = z.object({
  id: idSchema,
  status: orderStatusSchema,
  customerName: z.string(),
  customerPhone: z.string(),
  deliveryAddress: z.string(),
  // Сумма в копейках: целое число без ошибок округления.
  amountMinor: z.number().int().positive(),
  restaurant: referenceSchema,
  courier: referenceSchema.nullable(),
  // Версия для оптимистичной блокировки: та же, что в заголовке ETag.
  version: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const orderListSchema = z.object({
  items: z.array(orderSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export const orderEventSchema = z.object({
  id: idSchema,
  action: z.enum(ORDER_EVENT_ACTIONS),
  fromStatus: orderStatusSchema.nullable(),
  toStatus: orderStatusSchema.nullable(),
  fromCourier: referenceSchema.nullable(),
  toCourier: referenceSchema.nullable(),
  reason: z.string().nullable(),
  // null — действие не оператора (заказ создан клиентским приложением).
  actor: referenceSchema.nullable(),
  orderVersion: z.number().int().positive(),
  createdAt: timestampSchema,
});

// Событие потока GET /api/stream: заказ изменился. Внутри — та же запись audit, что в истории:
// фронт обновит данные и покажет, кто и что изменил.
export const ORDER_CHANGED_EVENT = 'order.changed';

export const orderChangedEventSchema = z.object({
  orderId: idSchema,
  event: orderEventSchema,
});

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type OrderSortOption = (typeof ORDER_SORT_OPTIONS)[number];
export type TransitionBody = z.infer<typeof transitionBodySchema>;
export type CourierBody = z.infer<typeof courierBodySchema>;
export type CancelBody = z.infer<typeof cancelBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type Operator = z.infer<typeof operatorSchema>;
export type OperatorOption = z.infer<typeof operatorOptionSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Restaurant = z.infer<typeof restaurantSchema>;
export type Courier = z.infer<typeof courierSchema>;
export type Order = z.infer<typeof orderSchema>;
export type OrderList = z.infer<typeof orderListSchema>;
export type OrderEvent = z.infer<typeof orderEventSchema>;
export type OrderChangedEvent = z.infer<typeof orderChangedEventSchema>;
