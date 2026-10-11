import type { Order } from '@foodster/shared';
import { notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { orderQuery } from '../api/orders';
import { makeEvent, makeOrder } from '../test/fixtures';
import { useOrderActions } from './useOrderActions';

// Ответы API подменяются в fetch: по методу и пути — заготовка ответа. Журнал запросов
// показывает, что ушло на сервер (метод, путь, If-Match).
type Reply = { status: number; body: unknown; etag?: string };
function stubApi(routes: Record<string, () => Reply>) {
  const log: { method: string; path: string; ifMatch: string | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const headers = (init.headers ?? {}) as Record<string, string>;
      log.push({ method, path, ifMatch: headers['if-match'] });
      const route = routes[`${method} ${path}`];
      if (!route) return Promise.reject(new Error(`no route ${method} ${path}`));
      const { status, body, etag } = route();
      const contentType = status >= 400 ? 'application/problem+json' : 'application/json';
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': contentType, ...(etag ? { etag } : {}) },
        }),
      );
    }),
  );
  return log;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(order: Order) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(orderQuery(order.id).queryKey, {
    data: order,
    etag: `"v${order.version}"`,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useOrderActions(order.id), { wrapper });
  return { ...hook, queryClient };
}

const conflictBody = (current: Order) => ({
  type: 'about:blank',
  title: 'Precondition Failed',
  status: 412,
  detail: 'Заказ уже изменил другой оператор',
  instance: `/api/orders/${current.id}/transitions`,
  code: 'VERSION_CONFLICT',
  current,
  lastChange: makeEvent({ orderVersion: current.version }),
});

describe('useOrderActions', () => {
  it('успех: ответ сервера (заказ и новый ETag) сразу становится данными карточки', async () => {
    const order = makeOrder({ status: 'accepted', version: 2 });
    const changed = { ...order, status: 'preparing' as const, version: 3 };
    const log = stubApi({
      'POST /api/orders/196/transitions': () => ({ status: 200, body: changed, etag: '"v3"' }),
    });
    const { result, queryClient } = setup(order);

    act(() => result.current.run({ kind: 'transition', to: 'preparing' }, '"v2"'));
    // Ждём наблюдаемый результат, а не isPending: React узнаёт о старте мутации не сразу,
    // и «isPending === false» выполнилось бы ещё до запроса.
    await waitFor(() =>
      expect(queryClient.getQueryData(orderQuery(196).queryKey)).toEqual({
        data: changed,
        etag: '"v3"',
      }),
    );
    expect(log).toEqual([{ method: 'POST', path: '/api/orders/196/transitions', ifMatch: '"v2"' }]);
  });

  it('не откатывает карточку: если в кэше уже версия новее ответа, остаётся она', async () => {
    const order = makeOrder({ version: 2 });
    stubApi({
      'POST /api/orders/196/transitions': () => ({
        status: 200,
        body: { ...order, status: 'preparing', version: 3 },
        etag: '"v3"',
      }),
      'GET /api/orders/196/events': () => ({ status: 200, body: [] }),
    });
    const { result, queryClient } = setup(order);
    // Пока ответ шёл, по SSE пришло изменение другого оператора — в кэше уже версия 4.
    const newer = { data: { ...order, status: 'preparing' as const, version: 4 }, etag: '"v4"' };

    const toast = vi.spyOn(notifications, 'show');
    act(() => result.current.run({ kind: 'transition', to: 'preparing' }, '"v2"'));
    queryClient.setQueryData(orderQuery(196).queryKey, newer);
    // Уведомление показывает onSuccess — значит, ответ уже обработан.
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Статус изменён' })),
    );

    expect(queryClient.getQueryData(orderQuery(196).queryKey)).toEqual(newer);
  });

  it('двойной запуск подряд — один запрос', async () => {
    const order = makeOrder();
    const log = stubApi({
      'POST /api/orders/196/transitions': () => ({
        status: 200,
        body: { ...order, version: 3 },
        etag: '"v3"',
      }),
    });
    const { result } = setup(order);
    act(() => {
      result.current.run({ kind: 'transition', to: 'preparing' }, '"v2"');
      result.current.run({ kind: 'transition', to: 'preparing' }, '"v2"');
    });
    await waitFor(() => expect(log).toHaveLength(1));
    expect(log.filter((entry) => entry.method === 'POST')).toHaveLength(1);
  });

  it('412: конфликт с актуальным заказом; «Повторить» — то же действие с новой версией', async () => {
    const order = makeOrder({ status: 'accepted', version: 2 });
    // Другой оператор назначил курьера: статус тот же, версия 3 — переход всё ещё допустим.
    const current = { ...order, courier: { id: 7, name: 'Агап Блинов' }, version: 3 };
    let postCount = 0;
    const log = stubApi({
      'POST /api/orders/196/transitions': () =>
        ++postCount === 1
          ? { status: 412, body: conflictBody(current) }
          : { status: 200, body: { ...current, status: 'preparing', version: 4 }, etag: '"v4"' },
      'GET /api/orders/196': () => ({ status: 200, body: current, etag: '"v3"' }),
      'GET /api/orders/196/events': () => ({ status: 200, body: [] }),
    });
    const { result } = setup(order);

    act(() => result.current.run({ kind: 'transition', to: 'preparing' }, '"v2"'));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    expect(result.current.conflict?.problem.current).toEqual(current);
    // Ошибку конфликта показывает модалка, а не панель.
    expect(result.current.error).toBeNull();

    await act(() => result.current.retry());
    await waitFor(() => expect(result.current.isPending).toBe(false));

    const posts = log.filter((entry) => entry.method === 'POST');
    expect(posts.map((entry) => entry.ifMatch)).toEqual(['"v2"', '"v3"']);
  });

  it('«Повторить», а заказ тем временем изменили ещё раз, — повтор не отправляется', async () => {
    const order = makeOrder({ version: 2 });
    const seen = { ...order, courier: { id: 7, name: 'Агап Блинов' }, version: 3 };
    const later = { ...seen, version: 4 };
    const log = stubApi({
      'POST /api/orders/196/transitions': () => ({ status: 412, body: conflictBody(seen) }),
      'GET /api/orders/196': () => ({ status: 200, body: later, etag: '"v4"' }),
      'GET /api/orders/196/events': () => ({ status: 200, body: [] }),
    });
    const { result } = setup(order);

    act(() => result.current.run({ kind: 'transition', to: 'preparing' }, '"v2"'));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    await act(() => result.current.retry());

    expect(log.filter((entry) => entry.method === 'POST')).toHaveLength(1);
    expect(result.current.isPending).toBe(false);
  });

  it('«Повторить», а действие для нового состояния недопустимо, — повтор не отправляется, панель снова работает', async () => {
    const order = makeOrder({ status: 'accepted', version: 2 });
    // Другой оператор успел отменить заказ: переход дальше невозможен.
    const cancelled = { ...order, status: 'cancelled' as const, version: 3 };
    let posts = 0;
    const log = stubApi({
      'POST /api/orders/196/transitions': () =>
        ++posts === 1
          ? { status: 412, body: conflictBody(cancelled) }
          : { status: 200, body: { ...order, version: 9 }, etag: '"v9"' },
      'GET /api/orders/196': () => ({ status: 200, body: cancelled, etag: '"v3"' }),
      'GET /api/orders/196/events': () => ({ status: 200, body: [] }),
    });
    const { result } = setup(order);

    act(() => result.current.run({ kind: 'transition', to: 'preparing' }, '"v2"'));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    await act(() => result.current.retry());
    expect(log.filter((entry) => entry.method === 'POST')).toHaveLength(1);

    // Флаг «идёт запрос» снят: следующее действие уходит (а не молча игнорируется).
    act(() => result.current.run({ kind: 'transition', to: 'preparing' }, '"v3"'));
    await waitFor(() => expect(log.filter((entry) => entry.method === 'POST')).toHaveLength(2));
  });

  it('409: текст правила для панели, конфликта нет', async () => {
    const order = makeOrder({ status: 'ready', version: 4 });
    stubApi({
      'PUT /api/orders/196/courier': () => ({
        status: 409,
        body: {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: 'У курьера уже максимум активных доставок: 3',
          instance: '/api/orders/196/courier',
          code: 'COURIER_LIMIT_REACHED',
          courier: { id: 7, name: 'Агап Блинов' },
          activeDeliveries: 3,
          limit: 3,
        },
      }),
      'GET /api/orders/196': () => ({ status: 200, body: order, etag: '"v4"' }),
      'GET /api/orders/196/events': () => ({ status: 200, body: [] }),
    });
    const { result } = setup(order);

    act(() => result.current.run({ kind: 'courier', courierId: 7 }, '"v4"'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('У курьера уже максимум активных доставок: 3');
    expect(result.current.conflict).toBeNull();
  });
});
