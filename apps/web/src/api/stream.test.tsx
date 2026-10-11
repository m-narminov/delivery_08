import { ORDER_CHANGED_EVENT } from '@foodster/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { makeEvent } from '../test/fixtures';
import { subscribeToOrderChanges, useOrderStream } from './stream';

// Поддельный EventSource: тест сам решает, когда поток открылся, пришло событие или оборвалась
// связь. В jsdom настоящего EventSource нет, и сервер здесь не нужен.
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((message: MessageEvent<string>) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (message: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  emit(data: string) {
    for (const listener of this.listeners.get(ORDER_CHANGED_EVENT) ?? []) {
      listener(new MessageEvent(ORDER_CHANGED_EVENT, { data }));
    }
  }
  fail(readyState: number) {
    this.readyState = readyState;
    this.onerror?.();
  }
}

const session = { operator: { id: 1, name: 'Медведев Юлий', email: 'm@example.com' } };

function stubSession(status: 200 | 401) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        status === 200
          ? new Response(JSON.stringify(session), {
              headers: { 'content-type': 'application/json' },
            })
          : new Response(null, { status: 401 }),
      ),
    ),
  );
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useOrderStream(), { wrapper });
  const source = () => {
    const last = FakeEventSource.instances.at(-1);
    if (!last) throw new Error('поток не создан');
    return last;
  };
  const invalidatedKeys = () =>
    invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
  return { ...hook, invalidate, invalidatedKeys, source };
}

const change = (orderId: number) => JSON.stringify({ orderId, event: makeEvent() });

describe('useOrderStream', () => {
  it('при подключении — перезапрос всех данных заказов (истории событий у сервера нет)', async () => {
    const { result, source, invalidatedKeys } = setup();
    expect(result.current.status).toBe('connecting');
    act(() => source().open());
    expect(result.current.status).toBe('open');
    await waitFor(() => expect(invalidatedKeys()).toContain('["orders"]'));
  });

  it('события за 300 мс — одной пачкой: список один раз, карточка и история каждого заказа', async () => {
    const { source, invalidate, invalidatedKeys } = setup();
    act(() => source().open());
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    invalidate.mockClear();

    act(() => {
      source().emit(change(196));
      source().emit(change(70));
      source().emit(change(196));
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidatedKeys();
    expect(keys.filter((key) => key === '["orders","list"]')).toHaveLength(1);
    expect(keys).toEqual(
      expect.arrayContaining([
        '["orders","couriers"]',
        '["orders","detail",196]',
        '["orders","events",196]',
        '["orders","detail",70]',
        '["orders","events",70]',
      ]),
    );
  });

  it('подписчики получают изменение; битые данные игнорируются', () => {
    const { source } = setup();
    const listener = vi.fn();
    // Снять подписку и при падении теста: иначе слушатель остался бы в модуле для следующих.
    onTestFinished(subscribeToOrderChanges(listener));
    act(() => {
      source().open();
      source().emit('не json');
      source().emit(JSON.stringify({ orderId: 'x' }));
      source().emit(change(196));
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ orderId: 196 });
  });

  it('обрыв — «переподключение» (браузер переподключится сам)', () => {
    const { result, source } = setup();
    act(() => source().open());
    act(() => source().fail(FakeEventSource.CONNECTING));
    expect(result.current.status).toBe('reconnecting');
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('отказ сервера при живой сессии — «отключены» и новый поток через 3 с', async () => {
    stubSession(200);
    const { result, source } = setup();
    vi.useFakeTimers();
    act(() => source().fail(FakeEventSource.CLOSED));
    expect(result.current.status).toBe('closed');
    // Ждём ответ проверки сессии (промис), затем паузу перед повтором.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

  it('отказ, а сессии нет — перезапрос заказов (их 401 запустит общий переход на вход)', async () => {
    stubSession(401);
    const { source, invalidatedKeys } = setup();
    act(() => source().fail(FakeEventSource.CLOSED));
    await waitFor(() => expect(invalidatedKeys()).toContain('["orders"]'));
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('«Повторить» сразу создаёт новый поток', () => {
    const { result } = setup();
    act(() => result.current.retry());
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});
