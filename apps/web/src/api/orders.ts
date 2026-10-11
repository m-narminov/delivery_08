import { orderListSchema, restaurantSchema } from '@foodster/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { toApiQuery, type OrdersSearch } from '../orders/search';
import { apiRequest } from './client';

// Ключи запросов заказов: по префиксу ['orders'] их можно разом пометить устаревшими (SSE, 8d).
export const ordersKeys = {
  all: ['orders'] as const,
  list: (search: OrdersSearch) => ['orders', 'list', search] as const,
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
