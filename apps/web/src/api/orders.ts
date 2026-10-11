import { orderEventSchema, orderListSchema, orderSchema, restaurantSchema } from '@foodster/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { toApiQuery, type OrdersSearch } from '../orders/search';
import { apiRequest } from './client';

// Ключи запросов заказов: по префиксу ['orders'] их можно разом пометить устаревшими (SSE, 8d).
export const ordersKeys = {
  all: ['orders'] as const,
  list: (search: OrdersSearch) => ['orders', 'list', search] as const,
  detail: (id: number) => ['orders', 'detail', id] as const,
  events: (id: number) => ['orders', 'events', id] as const,
};

export function ordersListQuery(search: OrdersSearch) {
  return queryOptions({
    queryKey: ordersKeys.list(search),
    queryFn: async ({ signal }) =>
      (await apiRequest(`/api/orders?${toApiQuery(search)}`, orderListSchema, { signal })).data,
    // При смене страницы или фильтра таблица показывает прежние строки, пока грузятся новые,
    // а не мигает пустотой.
    placeholderData: keepPreviousData,
  });
}

// Справочник ресторанов для фильтра: меняется редко.
export const restaurantsQuery = queryOptions({
  queryKey: ['restaurants'],
  queryFn: async ({ signal }) =>
    (await apiRequest('/api/restaurants', z.array(restaurantSchema), { signal })).data,
  staleTime: 5 * 60 * 1000,
});

// Карточка заказа вместе с ETag: версия понадобится для If-Match при изменении.
export function orderQuery(id: number) {
  return queryOptions({
    queryKey: ordersKeys.detail(id),
    queryFn: ({ signal }) => apiRequest(`/api/orders/${id}`, orderSchema, { signal }),
  });
}

// История изменений заказа (audit), от старых к новым.
export function orderEventsQuery(id: number) {
  return queryOptions({
    queryKey: ordersKeys.events(id),
    queryFn: async ({ signal }) =>
      (await apiRequest(`/api/orders/${id}/events`, z.array(orderEventSchema), { signal })).data,
  });
}
