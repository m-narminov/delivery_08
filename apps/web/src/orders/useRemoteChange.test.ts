import type { OrderChangedEvent } from '@foodster/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEvent } from '../test/fixtures';
import { useRemoteChange } from './useRemoteChange';

// Поток подменён: тест сам рассылает изменения подписчикам, как это делает useOrderStream.
const listeners = vi.hoisted(() => new Set<(change: OrderChangedEvent) => void>());
vi.mock('../api/stream', () => ({
  subscribeToOrderChanges: (listener: (change: OrderChangedEvent) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

function broadcast(change: OrderChangedEvent) {
  act(() => {
    for (const listener of listeners) listener(change);
  });
}

const ME = 1;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useRemoteChange — плашка «Заказ только что изменили»', () => {
  it('изменение другого оператора по этому заказу — показываем, кнопки на секунду недоступны', () => {
    const { result } = renderHook(() => useRemoteChange(196, ME));
    const event = makeEvent({ actor: { id: 2, name: 'Мария Иванова' } });
    broadcast({ orderId: 196, event });
    expect(result.current.event).toEqual(event);
    expect(result.current.locked).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.locked).toBe(false);
  });

  it('второе чужое изменение в пределах секунды продлевает блокировку', () => {
    const { result } = renderHook(() => useRemoteChange(196, ME));
    broadcast({ orderId: 196, event: makeEvent() });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    broadcast({ orderId: 196, event: makeEvent({ id: 2 }) });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.locked).toBe(true);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.locked).toBe(false);
  });

  it('своё изменение и изменение другого заказа — не показываем', () => {
    const { result } = renderHook(() => useRemoteChange(196, ME));
    broadcast({ orderId: 196, event: makeEvent({ actor: { id: ME, name: 'Я' } }) });
    broadcast({ orderId: 70, event: makeEvent() });
    expect(result.current.event).toBeNull();
    expect(result.current.locked).toBe(false);
  });

  it('изменение без автора (клиентское приложение) — показываем', () => {
    const { result } = renderHook(() => useRemoteChange(196, ME));
    broadcast({ orderId: 196, event: makeEvent({ actor: null }) });
    expect(result.current.event?.actor).toBeNull();
  });

  it('«Скрыть» убирает плашку; после размонтирования подписка снята', () => {
    const { result, unmount } = renderHook(() => useRemoteChange(196, ME));
    broadcast({ orderId: 196, event: makeEvent() });
    act(() => result.current.dismiss());
    expect(result.current.event).toBeNull();
    unmount();
    expect(listeners.size).toBe(0);
  });
});
