import { describe, expect, it } from 'vitest';
import {
  canCancel,
  canTransition,
  checkCourierChange,
  checkStatusChange,
  isTerminal,
  nextStatus,
} from './order-fsm';
import { ORDER_STATUSES, type OrderStatus } from './order-status';

// Ожидания записаны независимо от таблицы TRANSITIONS: тест сверяет код с заданием,
// а не сам с собой. Всё, чего нет в списке, должно быть запрещено.
const EXPECTED_TRANSITIONS = new Set([
  'new → accepted',
  'accepted → preparing',
  'preparing → ready',
  'ready → picked_up',
  'picked_up → delivered',
  'new → cancelled',
  'accepted → cancelled',
  'preparing → cancelled',
  'ready → cancelled',
]);

const ALL_PAIRS = ORDER_STATUSES.flatMap((from) => ORDER_STATUSES.map((to) => [from, to] as const));

describe('canTransition', () => {
  it('проверяет все 49 пар статусов', () => {
    expect(ALL_PAIRS).toHaveLength(49);
  });

  it.each(ALL_PAIRS)('%s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(EXPECTED_TRANSITIONS.has(`${from} → ${to}`));
  });
});

describe('nextStatus', () => {
  it('ведёт по основной цепочке от new до delivered', () => {
    const chain: OrderStatus[] = ['new'];
    for (let status = nextStatus('new'); status !== null; status = nextStatus(status)) {
      chain.push(status);
      if (chain.length > ORDER_STATUSES.length) throw new Error('цикл в таблице переходов');
    }
    expect(chain).toEqual(['new', 'accepted', 'preparing', 'ready', 'picked_up', 'delivered']);
  });

  it('никогда не возвращает cancelled', () => {
    for (const status of ORDER_STATUSES) {
      expect(nextStatus(status)).not.toBe('cancelled');
    }
  });
});

describe('canCancel', () => {
  it.each([
    ['new', true],
    ['accepted', true],
    ['preparing', true],
    ['ready', true],
    ['picked_up', false],
    ['delivered', false],
    ['cancelled', false],
  ] as const)('%s → %s', (status, expected) => {
    expect(canCancel(status)).toBe(expected);
  });
});

describe('isTerminal', () => {
  it('конечные статусы — только delivered и cancelled', () => {
    expect(ORDER_STATUSES.filter(isTerminal)).toEqual(['delivered', 'cancelled']);
  });
});

describe('checkStatusChange', () => {
  it('разрешает picked_up, если курьер назначен', () => {
    expect(checkStatusChange({ status: 'ready', courierId: 7 }, 'picked_up')).toEqual({ ok: true });
  });

  it('запрещает picked_up без курьера', () => {
    expect(checkStatusChange({ status: 'ready', courierId: null }, 'picked_up')).toEqual({
      ok: false,
      code: 'COURIER_REQUIRED',
    });
  });

  it('разрешает ready без курьера', () => {
    expect(checkStatusChange({ status: 'preparing', courierId: null }, 'ready')).toEqual({
      ok: true,
    });
  });

  it('недопустимый переход проверяется раньше наличия курьера', () => {
    expect(checkStatusChange({ status: 'new', courierId: null }, 'picked_up')).toEqual({
      ok: false,
      code: 'TRANSITION_NOT_ALLOWED',
    });
  });

  it('запрещает откат назад', () => {
    expect(checkStatusChange({ status: 'ready', courierId: 7 }, 'preparing')).toEqual({
      ok: false,
      code: 'TRANSITION_NOT_ALLOWED',
    });
  });
});

describe('checkCourierChange', () => {
  it.each([
    ['new', true],
    ['accepted', true],
    ['preparing', true],
    ['ready', true],
    ['picked_up', false],
    ['delivered', false],
    ['cancelled', false],
  ] as const)('%s → разрешено: %s', (status, allowed) => {
    expect(checkCourierChange({ status }).ok).toBe(allowed);
  });
});
