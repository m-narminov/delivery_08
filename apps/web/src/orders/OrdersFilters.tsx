import {
  ORDER_SORT_OPTIONS,
  ORDER_STATUSES,
  SEARCH_QUERY_MAX_LENGTH,
  type OrderSortOption,
} from '@foodster/shared';
import { Button, Group, MultiSelect, Select, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { Ref } from 'react';
import { errorMessage } from '../api/errors';
import { restaurantsQuery } from '../api/orders';
import { formatStatuses, hasFilters, parseStatuses, type OrdersSearch } from './search';
import { STATUS_LABELS } from './status';
import type { SearchText } from './useSearchText';

const SORT_LABELS: Record<OrderSortOption, string> = {
  'createdAt:desc': 'Сначала новые',
  'createdAt:asc': 'Сначала старые',
  'updatedAt:desc': 'Недавно изменённые',
  'updatedAt:asc': 'Давно не менялись',
  'amount:desc': 'Сумма: по убыванию',
  'amount:asc': 'Сумма: по возрастанию',
};

interface OrdersFiltersProps {
  search: OrdersSearch;
  searchText: SearchText;
  searchInputRef: Ref<HTMLInputElement>;
  onChange: (patch: Partial<OrdersSearch>) => void;
  onReset: () => void;
}

export function OrdersFilters({
  search,
  searchText,
  searchInputRef,
  onChange,
  onReset,
}: OrdersFiltersProps) {
  const restaurants = useQuery(restaurantsQuery);
  const restaurantOptions = (restaurants.data ?? []).map((restaurant) => ({
    value: String(restaurant.id),
    label: restaurant.name,
  }));
  // Ресторана из адреса нет в справочнике (старая ссылка): фильтр всё равно действует,
  // поэтому показываем его, а не пустое поле с подписью «Все».
  const selectedRestaurant = search.restaurantId === undefined ? null : String(search.restaurantId);
  if (
    selectedRestaurant !== null &&
    restaurants.isSuccess &&
    !restaurantOptions.some((option) => option.value === selectedRestaurant)
  ) {
    restaurantOptions.push({
      value: selectedRestaurant,
      label: `Ресторан № ${selectedRestaurant}`,
    });
  }

  return (
    <Group align="flex-end" gap="sm" wrap="wrap">
      <TextInput
        ref={searchInputRef}
        label="Поиск по адресу"
        description="Опечатки и неверная раскладка не страшны"
        placeholder="Например, садовая 5"
        value={searchText.text}
        onChange={(event) => searchText.change(event.currentTarget.value)}
        // Длиннее API не примет: обрезать молча хуже, чем не дать ввести.
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        w={{ base: '100%', sm: 300 }}
        type="search"
      />
      <MultiSelect
        label="Статус"
        placeholder={search.status ? undefined : 'Все'}
        data={ORDER_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
        value={parseStatuses(search.status)}
        onChange={(values) => onChange({ status: formatStatuses(parseStatuses(values.join(','))) })}
        clearable
        w={{ base: '100%', sm: 280 }}
      />
      <Select
        label="Ресторан"
        placeholder={restaurants.isPending ? 'Загрузка…' : 'Все'}
        data={restaurantOptions}
        value={selectedRestaurant}
        onChange={(value) => onChange({ restaurantId: value === null ? undefined : Number(value) })}
        error={restaurants.isError ? errorMessage(restaurants.error) : undefined}
        searchable
        clearable
        nothingFoundMessage="Не найден"
        w={{ base: '100%', sm: 220 }}
      />
      <Select
        label="Сортировка"
        data={ORDER_SORT_OPTIONS.map((sort) => ({ value: sort, label: SORT_LABELS[sort] }))}
        value={search.sort}
        onChange={(value) => {
          const sort = ORDER_SORT_OPTIONS.find((option) => option === value);
          if (sort) onChange({ sort });
        }}
        allowDeselect={false}
        w={{ base: '100%', sm: 220 }}
      />
      {(hasFilters(search) || searchText.text !== '') && (
        <Button variant="subtle" onClick={onReset}>
          Сбросить фильтры
        </Button>
      )}
    </Group>
  );
}
