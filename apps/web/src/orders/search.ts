import {
  ORDER_SORT_OPTIONS,
  ORDER_STATUSES,
  SEARCH_QUERY_MAX_LENGTH,
  type OrderStatus,
} from '@foodster/shared';
import { z } from 'zod';

// Фильтры списка живут в адресе страницы: ссылку можно отправить коллеге, «Назад» возвращает
// прежние фильтры, обновление страницы их не теряет.

export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export const DEFAULT_ORDERS_SEARCH = {
  sort: 'createdAt:desc',
  page: 1,
  pageSize: 20,
} as const;

// ?status=new,ready — как в API. Неизвестные значения отбрасываем, порядок — как в жизненном
// цикле, повторы убираем: одинаковый фильтр — одинаковый адрес и одна запись в кэше.
export function parseStatuses(value: string | undefined): OrderStatus[] {
  if (!value) return [];
  const chosen = new Set(value.split(',').map((item) => item.trim()));
  return ORDER_STATUSES.filter((status) => chosen.has(status));
}

export function formatStatuses(statuses: readonly OrderStatus[]): string | undefined {
  const ordered = ORDER_STATUSES.filter((status) => statuses.includes(status));
  return ordered.length > 0 ? ordered.join(',') : undefined;
}

// Адрес правит кто угодно: мусор в параметре не ломает страницу (catch), а становится
// значением по умолчанию.
export const ordersSearchSchema = z.object({
  status: z
    .string()
    .transform((value) => formatStatuses(parseStatuses(value)))
    .optional()
    .catch(undefined),
  restaurantId: z.coerce.number().int().positive().optional().catch(undefined),
  // coerce: роутер разбирает значения как JSON, и ?q=12 пришёл бы числом.
  q: z.coerce
    .string()
    .trim()
    .max(SEARCH_QUERY_MAX_LENGTH)
    .transform((value) => value || undefined)
    .optional()
    .catch(undefined),
  sort: z
    .enum(ORDER_SORT_OPTIONS)
    .default(DEFAULT_ORDERS_SEARCH.sort)
    .catch(DEFAULT_ORDERS_SEARCH.sort),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_ORDERS_SEARCH.page)
    .catch(DEFAULT_ORDERS_SEARCH.page),
  pageSize: z.coerce
    .number()
    .pipe(z.union(PAGE_SIZE_OPTIONS.map((size) => z.literal(size))))
    .default(DEFAULT_ORDERS_SEARCH.pageSize)
    .catch(DEFAULT_ORDERS_SEARCH.pageSize),
});

export type OrdersSearch = z.output<typeof ordersSearchSchema>;

export function hasFilters(search: OrdersSearch): boolean {
  return search.status !== undefined || search.restaurantId !== undefined || search.q !== undefined;
}

// Параметры запроса к GET /api/orders.
export function toApiQuery(search: OrdersSearch): string {
  const params = new URLSearchParams({
    sort: search.sort,
    page: String(search.page),
    pageSize: String(search.pageSize),
  });
  if (search.status) params.set('status', search.status);
  if (search.restaurantId !== undefined) params.set('restaurantId', String(search.restaurantId));
  if (search.q) params.set('q', search.q);
  return params.toString();
}
