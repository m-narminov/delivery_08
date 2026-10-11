import type { Order, OrderEvent } from '@foodster/shared';
import {
  Alert,
  Anchor,
  Box,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Timeline,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { useDocumentTitle } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useCanGoBack, useRouter } from '@tanstack/react-router';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { errorMessage } from '../api/errors';
import { orderEventsQuery, orderQuery } from '../api/orders';
import { AnchorLink } from '../components/AnchorLink';
import { Copyable } from '../components/Copyable';
import { ORDER_PAGE_MAX_WIDTH } from '../layouts/sizes';
import { formatDateTime, formatMoney, formatPhone, phoneE164 } from '../format';
import { describeEvent, eventActorName } from '../orders/events';
import { OrderActions } from '../orders/OrderActions';
import { useOrderActions } from '../orders/useOrderActions';
import { StatusBadge } from '../orders/StatusBadge';

const route = getRouteApi('/app/orders/$orderId');

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

// Назад к списку. Пришли из списка — шаг назад по истории: вернутся прежние фильтры и страница.
// Открыли карточку по ссылке (истории нет) — просто на список.
function BackToList() {
  const canGoBack = useCanGoBack();
  const router = useRouter();
  // alignSelf: в вертикальном стеке ссылка иначе растянулась бы на всю ширину, а у кнопки
  // текст по центру.
  return canGoBack ? (
    <Anchor
      component="button"
      type="button"
      onClick={() => router.history.back()}
      style={{ alignSelf: 'flex-start' }}
    >
      ← К списку заказов
    </Anchor>
  ) : (
    <AnchorLink to="/orders" style={{ alignSelf: 'flex-start' }}>
      ← К списку заказов
    </AnchorLink>
  );
}

// Значение с кнопкой копирования сразу за ним. Copyable прижимает кнопку к правому краю (так
// в таблице кнопки встают в столбец), а здесь строка одна — блок по ширине содержимого.
function CopyableInline(props: ComponentProps<typeof Copyable>) {
  return (
    <Box display="inline-block" maw="100%">
      <Copyable {...props} />
    </Box>
  );
}

function OrderDetails({ order, labelledBy }: { order: Order; labelledBy: string }) {
  // Таблица «поле — значение» (variant="vertical": заголовок строки слева): диктор читает
  // подпись вместе со значением.
  const rows: [string, ReactNode][] = [
    ['Клиент', order.customerName],
    [
      'Телефон',
      <CopyableInline
        key="phone"
        value={phoneE164(order.customerPhone)}
        label={`Скопировать телефон клиента заказа ${order.id}`}
      >
        {formatPhone(order.customerPhone)}
      </CopyableInline>,
    ],
    [
      'Адрес доставки',
      <CopyableInline
        key="address"
        value={order.deliveryAddress}
        label={`Скопировать адрес заказа ${order.id}`}
      >
        {order.deliveryAddress}
      </CopyableInline>,
    ],
    ['Ресторан', order.restaurant.name],
    [
      'Курьер',
      order.courier ? (
        order.courier.name
      ) : (
        <Text span c="dimmed" inherit>
          не назначен
        </Text>
      ),
    ],
    ['Сумма', formatMoney(order.amountMinor)],
    ['Создан', formatDateTime(order.createdAt)],
    ['Изменён', formatDateTime(order.updatedAt)],
  ];
  return (
    <Table
      variant="vertical"
      layout="fixed"
      withRowBorders
      aria-labelledby={labelledBy}
      // Значения длинные бывают любые (адрес, имя) — переносить и внутри слова, а не растягивать
      // карточку.
      style={{ overflowWrap: 'anywhere' }}
    >
      <Table.Tbody>
        {rows.map(([label, value]) => (
          <Table.Tr key={label}>
            {/* На телефоне столбец подписей уже: значению нужнее место. */}
            <Table.Th w={{ base: 124, sm: 140 }} scope="row">
              {label}
            </Table.Th>
            <Table.Td>{value}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function OrderHistory({ events }: { events: OrderEvent[] }) {
  return (
    // role list/listitem: Timeline рисует обычные div, а для диктора история — список записей.
    <Timeline bulletSize={14} lineWidth={2} active={events.length - 1} role="list">
      {events.map((event) => (
        <Timeline.Item key={event.id} title={describeEvent(event)} role="listitem">
          {event.reason && (
            // Причину оператор пишет сам: длинная ссылка без пробелов иначе растянула бы
            // страницу вбок.
            <Text size="sm" mt={4} style={{ overflowWrap: 'anywhere' }}>
              Причина: {event.reason}
            </Text>
          )}
          <Text size="xs" c="dimmed" mt={4}>
            {eventActorName(event)} · {formatDateTime(event.createdAt)}
          </Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}

// Ошибка загрузки блока с повтором. «Заказа нет» (404) сюда не попадает: для него у страницы
// своё сообщение.
function LoadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <Alert color="red" title="Не удалось загрузить">
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{errorMessage(error)}</Text>
        <Button size="xs" variant="light" color="red" onClick={onRetry}>
          Повторить
        </Button>
      </Stack>
    </Alert>
  );
}

export function OrderPage() {
  const { orderId } = route.useParams();
  const order = useQuery(orderQuery(orderId));
  const events = useQuery(orderEventsQuery(orderId));
  const detailsTitleId = useId();
  const actions = useOrderActions(orderId);
  // Номер заказа в заголовке вкладки: видно в списке вкладок и истории браузера (WCAG 2.4.2).
  // Хук только записывает заголовок и не возвращает прежний — поэтому его задаёт каждая
  // страница приложения сама.
  useDocumentTitle(
    isNotFound(order.error)
      ? 'Заказ не найден — Foodster Ops'
      : `Заказ № ${orderId} — Foodster Ops`,
  );

  if (isNotFound(order.error)) {
    return (
      <Stack gap="md" align="flex-start" maw={ORDER_PAGE_MAX_WIDTH} mx="auto">
        <BackToList />
        <Title order={1} size="h2">
          Заказ № {orderId} не найден
        </Title>
        <Text c="dimmed">Возможно, в адресе опечатка.</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md" maw={ORDER_PAGE_MAX_WIDTH} mx="auto">
      <BackToList />
      <Group gap="sm" align="center">
        <Title order={1} size="h2">
          Заказ № {orderId}
        </Title>
        {order.data && <StatusBadge status={order.data.data.status} />}
      </Group>

      {order.data && (
        <Paper withBorder radius="md" p="md">
          <OrderActions order={order.data.data} etag={order.data.etag} actions={actions} />
        </Paper>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        {/* alignSelf: start — карточка по своей высоте, а не до высоты истории рядом. */}
        <Paper withBorder radius="md" p="md" style={{ alignSelf: 'start' }}>
          <Title order={2} size="h4" mb="sm" id={detailsTitleId}>
            Данные заказа
          </Title>
          {order.data ? (
            <OrderDetails order={order.data.data} labelledBy={detailsTitleId} />
          ) : order.error ? (
            <LoadError error={order.error} onRetry={() => void order.refetch()} />
          ) : (
            <Stack gap="sm" role="status">
              <VisuallyHidden>Загрузка данных заказа…</VisuallyHidden>
              {Array.from({ length: 8 }, (_, row) => (
                <Skeleton key={row} height={20} radius="sm" />
              ))}
            </Stack>
          )}
        </Paper>

        <Paper withBorder radius="md" p="md">
          <Title order={2} size="h4" mb="sm">
            История изменений
          </Title>
          {events.data ? (
            <OrderHistory events={events.data} />
          ) : events.error && !isNotFound(events.error) ? (
            // 404 истории — заказа нет: страница вот-вот сменится на «не найден» по запросу
            // самого заказа (запросы параллельные, ответ истории может прийти раньше).
            <LoadError error={events.error} onRetry={() => void events.refetch()} />
          ) : (
            <Stack gap="sm" role="status">
              <VisuallyHidden>Загрузка истории…</VisuallyHidden>
              {Array.from({ length: 4 }, (_, row) => (
                <Skeleton key={row} height={36} radius="sm" />
              ))}
            </Stack>
          )}
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
