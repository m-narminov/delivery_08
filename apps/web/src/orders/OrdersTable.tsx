import type { Order } from '@foodster/shared';
import { useMergedRef } from '@mantine/hooks';
import { useEffect, useRef, useState, type Ref } from 'react';
import { Skeleton, Stack, Table, Text, VisuallyHidden } from '@mantine/core';
import { formatDateTime, formatMoney } from '../format';
import { StatusBadge } from './StatusBadge';

const COLUMNS = [
  '№',
  'Статус',
  'Клиент',
  'Ресторан',
  'Курьер',
  'Сумма',
  'Адрес доставки',
  'Создан',
  'Изменён',
] as const;

const SKELETON_ROWS = 8;

interface OrdersTableProps {
  // undefined — первая загрузка, данных ещё нет.
  orders: Order[] | undefined;
  // Идёт запрос, а на экране прежние строки (смена страницы или фильтра).
  refreshing: boolean;
  // Область прокрутки таблицы: на неё переводится фокус после смены страницы.
  viewportRef?: Ref<HTMLDivElement>;
}

export function OrdersTable({ orders, refreshing, viewportRef }: OrdersTableProps) {
  const ownViewportRef = useRef<HTMLDivElement>(null);
  const mergedViewportRef = useMergedRef(ownViewportRef, viewportRef);
  // Есть ли что прокручивать по горизонтали (узкий экран или широкое содержимое). Пока не
  // измерили — считаем, что есть: доступность с клавиатуры важнее лишней остановки Tab.
  const [scrollable, setScrollable] = useState(true);
  useEffect(() => {
    const viewport = ownViewportRef.current;
    if (!viewport) return;
    const measure = () => setScrollable(viewport.scrollWidth > viewport.clientWidth);
    measure();
    // Область меняется вместе с окном, таблица — с содержимым (данные, загрузка шрифта):
    // следим за обеими.
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    const table = viewport.querySelector('table');
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [orders]);

  return (
    // На узком экране таблица прокручивается по горизонтали, а не сжимается до нечитаемости.
    // Область прокрутки в порядке Tab, только когда есть что прокручивать: тогда таблицу можно
    // прокрутить с клавиатуры (стрелками), даже без ссылок и кнопок внутри. Иначе tabIndex -1:
    // лишней остановки Tab нет, но фокус после смены страницы на неё по-прежнему ставится.
    <Table.ScrollContainer
      minWidth={1100}
      scrollAreaProps={{
        viewportRef: mergedViewportRef,
        viewportProps: {
          tabIndex: scrollable ? 0 : -1,
          role: 'region',
          'aria-label': 'Таблица заказов',
        },
      }}
    >
      <Table
        striped
        highlightOnHover
        verticalSpacing="sm"
        aria-busy={orders === undefined || refreshing}
        style={{ opacity: refreshing ? 0.6 : 1, transition: 'opacity 150ms' }}
      >
        <Table.Caption>
          <VisuallyHidden>Список заказов</VisuallyHidden>
        </Table.Caption>
        <Table.Thead>
          <Table.Tr>
            {COLUMNS.map((column) => (
              <Table.Th key={column} scope="col">
                {column}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {orders === undefined
            ? Array.from({ length: SKELETON_ROWS }, (_, row) => (
                <Table.Tr key={row}>
                  {COLUMNS.map((column) => (
                    <Table.Td key={column}>
                      <Skeleton height={14} radius="sm" />
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))
            : orders.map((order) => (
                <Table.Tr key={order.id}>
                  <Table.Td>
                    <Text fw={600} size="sm">
                      {order.id}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge status={order.status} />
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={0}>
                      <Text size="sm">{order.customerName}</Text>
                      <Text size="xs" c="dimmed">
                        {order.customerPhone}
                      </Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td>{order.restaurant.name}</Table.Td>
                  <Table.Td>
                    {order.courier ? (
                      order.courier.name
                    ) : (
                      <Text size="sm" c="dimmed">
                        не назначен
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {formatMoney(order.amountMinor)}
                  </Table.Td>
                  <Table.Td>{order.deliveryAddress}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(order.createdAt)}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(order.updatedAt)}
                  </Table.Td>
                </Table.Tr>
              ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
