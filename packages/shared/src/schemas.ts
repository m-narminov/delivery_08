import { z } from 'zod';
import { CANCEL_REASON_MAX_LENGTH } from './order-rules';
import { ORDER_STATUSES } from './order-status';

export const orderStatusSchema = z.enum(ORDER_STATUSES);

// Всё, что приходит в URL, — строки, поэтому для path и query нужен coerce.
export const idParamSchema = z.coerce.number().int().positive();

const idSchema = z.number().int().positive();

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
    .trim()
    .max(SEARCH_QUERY_MAX_LENGTH)
    .transform((value) => value || undefined)
    .optional(),
  sort: z.enum(ORDER_SORT_OPTIONS).default('createdAt:desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

export const transitionBodySchema = z.object({
  to: orderStatusSchema,
});

export const courierBodySchema = z.object({
  courierId: idSchema.nullable(),
});

export const cancelBodySchema = z.object({
  // Пустая причина хранится как NULL. JS считает длину в UTF-16 единицах, а varchar(2000)
  // в Postgres — в символах, которых не больше. Прошедшее проверку всегда влезет в БД.
  reason: z
    .string()
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

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type OrderSortOption = (typeof ORDER_SORT_OPTIONS)[number];
export type TransitionBody = z.infer<typeof transitionBodySchema>;
export type CourierBody = z.infer<typeof courierBodySchema>;
export type CancelBody = z.infer<typeof cancelBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type Operator = z.infer<typeof operatorSchema>;
export type OperatorOption = z.infer<typeof operatorOptionSchema>;
export type Session = z.infer<typeof sessionSchema>;
