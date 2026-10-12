import {
  ORDER_SORT_OPTIONS,
  ORDER_STATUSES,
  SEARCH_QUERY_MAX_LENGTH,
  type OrderSortOption,
} from '@foodster/shared';
import { Button, Group, Input, MultiSelect, Select, TextInput } from '@mantine/core';
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

// Высота строки с подписью поля. Подпись — inline-block шрифтом 14px, но строку, в которой она
// стоит, по высоте задаёт шрифт обёртки (наследуется от body, 16px) × межстрочный интервал:
// 16 × 1,55 = 24,8 px. Так и измерено в браузере (верх поля — 24,8 px). На эту высоту сдвинута
// кнопка сброса, чтобы стоять вровень с полями, а не с их подписями.
const LABEL_HEIGHT = 'calc(var(--mantine-font-size-md) * var(--mantine-line-height))';

interface OrdersFiltersProps {
  search: OrdersSearch;
  searchText: SearchText;
  searchInputRef: Ref<HTMLInputElement>;
  onChange: (patch: Partial<OrdersSearch>) => void;
  onClearSearch: () => void;
  onReset: () => void;
}

export function OrdersFilters({
  search,
  searchText,
  searchInputRef,
  onChange,
  onClearSearch,
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
    // Подписи полей — на одном уровне (выравнивание по верху): выбранные статусы растягивают
    // поле вниз, а не поднимают его подпись над остальными.
    <Group align="flex-start" gap="sm" wrap="wrap">
      <TextInput
        ref={searchInputRef}
        label="Поиск по адресу"
        description="Опечатки и неверная раскладка не страшны"
        placeholder="Например, мостовая 140"
        // Подсказка под полем, а не между подписью и полем: иначе поле поиска было бы ниже
        // соседних.
        inputWrapperOrder={['label', 'input', 'description', 'error']}
        value={searchText.text}
        onChange={(event) => searchText.change(event.currentTarget.value)}
        // Длиннее API не примет: обрезать молча хуже, чем не дать ввести.
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        w={{ base: '100%', sm: 300 }}
        type="search"
        rightSection={
          searchText.text !== '' ? (
            <Input.ClearButton aria-label="Очистить поиск" onClick={onClearSearch} />
          ) : undefined
        }
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
        <Button
          variant="subtle"
          onClick={onReset}
          // Вровень с полями, а не с их подписями. На узком экране поля на всю ширину и кнопка
          // стоит на своей строке — там отступ не нужен.
          mt={{ base: 0, sm: LABEL_HEIGHT }}
        >
          Сбросить фильтры
        </Button>
      )}
    </Group>
  );
}
