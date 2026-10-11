import type { Order } from '@foodster/shared';
import { useMergedRef } from '@mantine/hooks';
import { memo, useEffect, useRef, useState, type Ref, type RefObject } from 'react';
import { Box, Skeleton, Table, Text, VisuallyHidden } from '@mantine/core';
import { AnchorLink } from '../components/AnchorLink';
import { Copyable } from '../components/Copyable';
import { formatDate, formatMoney, formatPhone, formatTime, phoneE164 } from '../format';
import { StatusBadge } from './StatusBadge';

// Столбцы с кнопкой копирования — по ширине самого длинного значения (FIT): кнопка у правого
// края ячейки, и в столбце все кнопки стоят ровно за самым длинным значением. Свободная ширина
// таблицы достаётся остальным столбцам. Суммы — по правому краю (вместе с заголовком), цифры
// одной ширины: так разряды стоят друг под другом.
// nowrap — у заголовка: пока строк нет (загрузка, короткие значения), столбец сжался бы до
// самого длинного слова, и «Адрес доставки» встал бы в две строки.
const FIT = { width: '1%', whiteSpace: 'nowrap' } as const;
const NOWRAP = { whiteSpace: 'nowrap' } as const;
const AMOUNT = { ...NOWRAP, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as const;
const DATE = { ...NOWRAP, fontVariantNumeric: 'tabular-nums' } as const;

const COLUMNS = [
  { label: '№', style: FIT },
  { label: 'Статус', style: FIT },
  { label: 'Клиент', style: FIT },
  { label: 'Ресторан' },
  { label: 'Курьер' },
  { label: 'Сумма', style: AMOUNT },
  { label: 'Адрес доставки', style: FIT },
  { label: 'Создан' },
  { label: 'Изменён' },
] as const;

const SKELETON_ROWS = 8;

// Дата и время в две строки (время мельче, как телефон под именем клиента): в одну строку
// столбцы дат занимали по 125–143 px, и вместе с широким столбцом «Курьер» таблица на
// большинстве страниц не помещалась на 1366 px. Цифры одной ширины — ширина столбца не
// зависит от того, какие цифры в датах на этой странице.
function DateTimeCell({ iso }: { iso: string }) {
  return (
    <Table.Td style={DATE}>
      <Text size="sm">{formatDate(iso)}</Text>
      <Text size="xs" c="dimmed">
        {formatTime(iso)}
      </Text>
    </Table.Td>
  );
}

// Разделители между столбцами (withColumnBorders) — бледнее границ строк, цвет из темы.
const CELL_STYLE = { borderInlineColor: 'var(--foodster-table-column-border)' } as const;
const TABLE_STYLES = { th: CELL_STYLE, td: CELL_STYLE } as const;

// Тень у края таблицы — подсказка, что в ту сторону есть что прокрутить. Поверх таблицы, но
// клики и полосу прокрутки не перехватывает (pointer-events: none). Скругление наследуется от
// карточки вокруг таблицы, чтобы тень не вылезала за её скруглённые углы.
function ScrollShadow({ side, visible }: { side: 'left' | 'right'; visible: boolean }) {
  return (
    <Box
      aria-hidden
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [side]: 0,
        width: 24,
        pointerEvents: 'none',
        borderRadius: 'inherit',
        background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, var(--foodster-scroll-shadow), transparent)`,
        opacity: visible ? 1 : 0,
        transition: 'opacity 150ms',
      }}
    />
  );
}

// Тени у обоих краёв и их состояние — отдельным компонентом: когда тень появляется или
// исчезает, перерисовываются только две полоски, а не таблица на 100 строк.
// watch — данные таблицы: при их смене пересчитать (меняется ширина содержимого).
function ScrollShadows({
  viewportRef,
  watch,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  watch: unknown;
}) {
  // Есть ли скрытое содержимое слева и справа. Пока не измерили — нет: лучше без тени
  // мгновение, чем мигнувшая лишняя.
  const [moreLeft, setMoreLeft] = useState(false);
  const [moreRight, setMoreRight] = useState(false);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const maxScroll = viewport.scrollWidth - viewport.clientWidth;
      // Запас в 1 px: scrollLeft бывает дробным и до максимума может не дотянуть на долю.
      setMoreLeft(viewport.scrollLeft > 1);
      setMoreRight(viewport.scrollLeft < maxScroll - 1);
    };
    measure();
    // Положение прокрутки — по событию scroll, размеры — как у измерения в таблице.
    // Состояние — булевы флаги: пока они те же, React перерисовку пропускает.
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    const table = viewport.querySelector('table');
    if (table) observer.observe(table);
    viewport.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', measure);
    };
  }, [viewportRef, watch]);

  return (
    <>
      <ScrollShadow side="left" visible={moreLeft} />
      <ScrollShadow side="right" visible={moreRight} />
    </>
  );
}

interface OrdersTableProps {
  // undefined — первая загрузка, данных ещё нет.
  orders: Order[] | undefined;
  // Идёт запрос, а на экране прежние строки (смена страницы или фильтра).
  refreshing: boolean;
  // Область прокрутки таблицы: на неё переводится фокус после смены страницы.
  viewportRef?: Ref<HTMLDivElement>;
}

// memo: страница перерисовывается на каждую букву в поиске (текст поля — её состояние), а у
// таблицы до 100 строк, в каждой три кнопки копирования с подсказкой. Пропсы при наборе не
// меняются (строки — тот же массив из кэша запроса), и перерисовка таблицы пропускается.
export const OrdersTable = memo(function OrdersTable({
  orders,
  refreshing,
  viewportRef,
}: OrdersTableProps) {
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
    // Обёртка с position: relative — опора для теней у краёв.
    <Box pos="relative" style={{ borderRadius: 'inherit' }}>
      <Table.ScrollContainer
        minWidth={1100}
        // Обёртку области прокрутки не прокручивать никак. У Mantine в режиме scrollarea её
        // overflow-x задан неопределённой переменной (--table-overflow) и вычисляется в auto: при
        // любом выступающем элементе её можно было протянуть пальцем за край таблицы — в пустую
        // белую область. clip, в отличие от hidden, не даёт прокрутить и программно.
        style={{ overflow: 'clip' }}
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
          withColumnBorders
          styles={TABLE_STYLES}
          verticalSpacing="sm"
          aria-busy={orders === undefined || refreshing}
          // position: relative — скрытые абсолютные элементы внутри (подпись таблицы, области
          // объявлений у кнопок копирования) позиционируются от таблицы, а значит, обрезаются
          // областью прокрутки и едут вместе с таблицей. Иначе они позиционировались бы от
          // обёртки Mantine вокруг области прокрутки и выступали бы из неё справа.
          style={{
            position: 'relative',
            opacity: refreshing ? 0.6 : 1,
            transition: 'opacity 150ms',
          }}
        >
          <Table.Caption>
            <VisuallyHidden>Список заказов</VisuallyHidden>
          </Table.Caption>
          <Table.Thead>
            <Table.Tr>
              {COLUMNS.map((column) => (
                <Table.Th
                  key={column.label}
                  scope="col"
                  style={'style' in column ? column.style : undefined}
                >
                  {column.label}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {orders === undefined
              ? Array.from({ length: SKELETON_ROWS }, (_, row) => (
                  <Table.Tr key={row}>
                    {COLUMNS.map((column) => (
                      <Table.Td key={column.label}>
                        <Skeleton height={14} radius="sm" />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))
              : orders.map((order) => (
                  <Table.Tr key={order.id}>
                    <Table.Td>
                      <Copyable
                        value={String(order.id)}
                        label={`Скопировать номер заказа ${order.id}`}
                      >
                        {/* Номер — ссылка на карточку: открывается и в новой вкладке. Подпись
                            «Заказ 196» для диктора: одно число среди ссылок непонятно. */}
                        <AnchorLink
                          to="/orders/$orderId"
                          params={{ orderId: order.id }}
                          fw={600}
                          size="sm"
                          aria-label={`Заказ ${order.id}`}
                        >
                          {order.id}
                        </AnchorLink>
                      </Copyable>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={order.status} />
                    </Table.Td>
                    <Table.Td>
                      <Copyable
                        // Имя и телефон одной строкой — удобно вставить в чат или письмо.
                        // Телефон — в E.164 (+79281824909): такой номер вставляется в звонилку
                        // и мессенджер без правки.
                        value={`${order.customerName}, ${phoneE164(order.customerPhone)}`}
                        label={`Скопировать данные клиента заказа ${order.id}`}
                        maxWidth="12rem"
                      >
                        <Text size="sm">{order.customerName}</Text>
                        <Text size="xs" c="dimmed">
                          {formatPhone(order.customerPhone)}
                        </Text>
                      </Copyable>
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
                    <Table.Td style={AMOUNT}>{formatMoney(order.amountMinor)}</Table.Td>
                    <Table.Td>
                      <Copyable
                        value={order.deliveryAddress}
                        label={`Скопировать адрес заказа ${order.id}`}
                        maxWidth="14.5rem"
                      >
                        <Text size="sm">{order.deliveryAddress}</Text>
                      </Copyable>
                    </Table.Td>
                    <DateTimeCell iso={order.createdAt} />
                    <DateTimeCell iso={order.updatedAt} />
                  </Table.Tr>
                ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <ScrollShadows viewportRef={ownViewportRef} watch={orders} />
    </Box>
  );
});
