import {
  Alert,
  Box,
  Button,
  Group,
  Pagination,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useDocumentTitle } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useLocation, useRouter } from '@tanstack/react-router';
import { useRef } from 'react';
import { errorMessage } from '../api/errors';
import { ordersListQuery } from '../api/orders';
import { plural } from '../format';
import { OrdersFilters } from '../orders/OrdersFilters';
import { OrdersTable } from '../orders/OrdersTable';
import {
  hasFilters,
  ordersSearchSchema,
  PAGE_SIZE_OPTIONS,
  type OrdersSearch,
} from '../orders/search';
import { useSearchText } from '../orders/useSearchText';

const route = getRouteApi('/app/orders');

const CONTROL_LABELS = {
  previous: 'Предыдущая страница',
  next: 'Следующая страница',
  first: 'Первая страница',
  last: 'Последняя страница',
} as const;

export function OrdersPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const orders = useQuery(ordersListQuery(search));
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Заголовок вкладки: после карточки («Заказ № N») вернуть название списка.
  useDocumentTitle('Заказы — Foodster Ops');
  const tableRef = useRef<HTMLDivElement>(null);

  // Поиск и ключ записи — из ожидающего адреса (router.stores.location выставляется в начале
  // перехода), а не из применённого маршрута: так своя отправка видна поиску сразу. В адресе
  // значения сырые (роутер ещё не применил схему), поэтому q проходит ту же проверку.
  const pending = useLocation({
    select: (location) => ({ q: location.search.q, key: location.state.__TSR_key }),
  });
  const pendingQ = ordersSearchSchema.shape.q.parse(pending.q);
  // Ключ записи истории, созданной нашей последней отправкой поиска.
  const searchEntryKey = useRef<string | undefined>(undefined);
  const searchText = useSearchText(pendingQ, pending.key, (q) => {
    // Набор поиска — одна запись в истории: первая отправка добавляет запись, следующие её
    // заменяют, но только если это всё ещё наша запись. После «Назад», перезагрузки или любого
    // другого перехода ключ другой — новый набор начнётся с новой записи и не затрёт прежнюю.
    const current = router.state.location.state.__TSR_key;
    const replace = current !== undefined && current === searchEntryKey.current;
    void navigate({ search: (prev) => ({ ...prev, q, page: 1 }), replace });
    // Ожидающий адрес обновляется сразу после navigate — это уже ключ новой записи.
    searchEntryKey.current = router.state.location.state.__TSR_key;
  });
  // Новый фильтр — с первой страницы: на прежней странице новых результатов может не быть.
  // Набранный, но не отправленный поиск уходит вместе с переходом (takePending).
  const changeFilters = (patch: Partial<OrdersSearch>) => {
    const q = searchText.takePending();
    void navigate({ search: (prev) => ({ ...prev, q, ...patch, page: 1 }) });
  };
  // Очистка поиска. Если поиск уже в адресе — переход на список без поиска с первой страницы;
  // если нет (текст ещё не отправлен) — только очистка поля. Фокус возвращаем в поле: кнопка
  // очистки исчезает, и фокус иначе ушёл бы в никуда.
  const clearSearch = () => {
    searchText.clear();
    if (pendingQ !== undefined) {
      void navigate({ search: (prev) => ({ ...prev, q: undefined, page: 1 }) });
    }
    searchInputRef.current?.focus();
  };
  // Сброс — только фильтров; сортировка и размер страницы остаются. Фокус — в поиск: кнопка
  // сброса исчезает, и фокус иначе ушёл бы в никуда.
  const resetFilters = () => {
    searchText.clear();
    void navigate({ search: (prev) => ({ sort: prev.sort, pageSize: prev.pageSize }) });
    searchInputRef.current?.focus();
  };
  // После смены страницы роутер прокручивает окно наверх, а фокус остался бы на пагинации
  // внизу — переводим его на таблицу. Не на итог: он объявляется сам (role="status"), и фокус
  // на нём заставил бы диктор прочесть его дважды.
  const goToPage = (page: number) => {
    const q = searchText.takePending();
    // Поиск успели изменить — это новый фильтр, и страница с прежними номерами неактуальна.
    const target = q === pendingQ ? page : 1;
    void navigate({ search: (prev) => ({ ...prev, q, page: target }) }).then(() =>
      tableRef.current?.focus(),
    );
  };

  const data = orders.data;
  // Пока грузятся новые данные, на экране прежние (keepPreviousData) — их «пусто» и итог
  // уже не про текущие фильтры, поэтому не показываем.
  const current = orders.isPlaceholderData ? undefined : data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Stack gap="md">
      <Title order={1} size="h2">
        Заказы
      </Title>

      <Paper withBorder p="md" radius="md">
        <OrdersFilters
          search={search}
          searchText={searchText}
          searchInputRef={searchInputRef}
          onChange={changeFilters}
          onClearSearch={clearSearch}
          onReset={resetFilters}
        />
      </Paper>

      {/* При смене фильтра или страницы ошибка заменяет таблицу (данных по новому запросу нет);
          при фоновом обновлении тех же фильтров — показывается над прежними данными. */}
      {orders.isError && (
        <Alert color="red" title="Не удалось загрузить заказы">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">{errorMessage(orders.error)}</Text>
            <Button size="xs" variant="light" color="red" onClick={() => void orders.refetch()}>
              Повторить
            </Button>
          </Stack>
        </Alert>
      )}

      {/* role="status": экранный диктор объявляет итог, когда меняется его текст. */}
      <Text size="sm" c="dimmed" role="status">
        {current
          ? `Найдено ${current.total} ${plural(current.total, ['заказ', 'заказа', 'заказов'])}` +
            (pages > 1 && search.page <= pages ? `, страница ${search.page} из ${pages}` : '')
          : orders.isError
            ? ''
            : 'Загрузка…'}
      </Text>

      {data && (
        <Paper withBorder radius="md">
          {current && current.items.length === 0 ? (
            <Stack align="center" gap="xs" p="xl">
              {current.total > 0 ? (
                <>
                  <Text>На этой странице заказов нет.</Text>
                  <Button variant="light" onClick={() => goToPage(1)}>
                    К первой странице
                  </Button>
                </>
              ) : hasFilters(search) ? (
                <>
                  <Text>По этим условиям заказов нет.</Text>
                  <Button variant="light" onClick={resetFilters}>
                    Сбросить фильтры
                  </Button>
                </>
              ) : (
                <Text>Заказов пока нет.</Text>
              )}
            </Stack>
          ) : (
            <OrdersTable
              // Прежний ответ без строк, пока грузятся новые, — скелетон, а не устаревшее «пусто».
              orders={data.items.length === 0 && orders.isPlaceholderData ? undefined : data.items}
              refreshing={orders.isPlaceholderData}
              viewportRef={tableRef}
            />
          )}
        </Paper>
      )}
      {!data && !orders.isError && (
        <Paper withBorder radius="md">
          <OrdersTable orders={undefined} refreshing={false} />
        </Paper>
      )}

      {/* Блок держится, пока грузится новая страница (иначе раскладка прыгает, а фокус из
          «На странице» терялся бы). За последней страницей пагинации нет: там кнопка
          «К первой странице». */}
      {data && data.total > 0 && (search.page <= pages || orders.isPlaceholderData) && (
        <Group justify="space-between" wrap="wrap" gap="sm">
          {/* flex: 1 — компактный вид Mantine включается по ширине самого блока пагинации
              (container query): блок шириной «по содержимому» сжался бы и был бы компактным
              всегда. */}
          <Box
            component="nav"
            aria-label="Страницы списка заказов"
            style={{ flex: 1, minWidth: 0 }}
          >
            <Pagination
              total={pages}
              value={Math.min(search.page, pages)}
              onChange={goToPage}
              // На узком экране — компактный вид вместо ряда кнопок, не влезающего в строку.
              layout="responsive"
              formatLabel={({ page, totalPages }) => `Страница ${page} из ${totalPages}`}
              getControlProps={(control) => ({ 'aria-label': CONTROL_LABELS[control] })}
              getItemProps={(page) => ({ 'aria-label': `Страница ${page}` })}
            />
          </Box>
          <Select
            label="На странице"
            data={PAGE_SIZE_OPTIONS.map((size) => String(size))}
            value={String(search.pageSize)}
            onChange={(value) => {
              const size = PAGE_SIZE_OPTIONS.find((option) => String(option) === value);
              if (size) changeFilters({ pageSize: size });
            }}
            allowDeselect={false}
            w={120}
          />
        </Group>
      )}
    </Stack>
  );
}
