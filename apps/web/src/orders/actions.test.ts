import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { makeEvent, makeOrder } from '../test/fixtures';
import {
  describeAction,
  fieldError,
  isActionAllowed,
  isAlreadyDone,
  versionConflictOf,
} from './actions';

const courier = { id: 7, name: 'Агап Блинов' };

describe('isActionAllowed — те же правила, что у API', () => {
  it('переход только на следующий шаг', () => {
    const order = makeOrder({ status: 'accepted' });
    expect(isActionAllowed(order, { kind: 'transition', to: 'preparing' })).toBe(true);
    expect(isActionAllowed(order, { kind: 'transition', to: 'ready' })).toBe(false);
    expect(isActionAllowed(order, { kind: 'transition', to: 'new' })).toBe(false);
  });

  it('«У курьера» — только с назначенным курьером', () => {
    expect(
      isActionAllowed(makeOrder({ status: 'ready' }), { kind: 'transition', to: 'picked_up' }),
    ).toBe(false);
    expect(
      isActionAllowed(makeOrder({ status: 'ready', courier }), {
        kind: 'transition',
        to: 'picked_up',
      }),
    ).toBe(true);
  });

  it('курьера можно менять до передачи в доставку; тот же курьер — не действие', () => {
    expect(isActionAllowed(makeOrder({ status: 'ready' }), { kind: 'courier', courierId: 7 })).toBe(
      true,
    );
    expect(
      isActionAllowed(makeOrder({ status: 'picked_up', courier }), {
        kind: 'courier',
        courierId: 8,
      }),
    ).toBe(false);
    expect(
      isActionAllowed(makeOrder({ status: 'ready', courier }), { kind: 'courier', courierId: 7 }),
    ).toBe(false);
    expect(
      isActionAllowed(makeOrder({ status: 'ready', courier }), {
        kind: 'courier',
        courierId: null,
      }),
    ).toBe(true);
  });

  it.each([
    ['new', true],
    ['ready', true],
    ['picked_up', false],
    ['delivered', false],
    ['cancelled', false],
  ] as const)('отмена из статуса %s — %s', (status, allowed) => {
    expect(isActionAllowed(makeOrder({ status }), { kind: 'cancel', reason: null })).toBe(allowed);
  });
});

describe('isAlreadyDone — другой оператор уже сделал то же самое', () => {
  it('тот же статус, тот же курьер, уже отменён', () => {
    expect(
      isAlreadyDone(makeOrder({ status: 'preparing' }), { kind: 'transition', to: 'preparing' }),
    ).toBe(true);
    expect(isAlreadyDone(makeOrder({ courier }), { kind: 'courier', courierId: 7 })).toBe(true);
    expect(
      isAlreadyDone(makeOrder({ status: 'cancelled' }), { kind: 'cancel', reason: null }),
    ).toBe(true);
    expect(isAlreadyDone(makeOrder(), { kind: 'courier', courierId: 7 })).toBe(false);
  });
});

describe('describeAction', () => {
  it('что пытался сделать оператор', () => {
    expect(describeAction({ kind: 'transition', to: 'ready' })).toBe(
      'перевести заказ в статус «Готов к выдаче»',
    );
    expect(describeAction({ kind: 'courier', courierId: 7 }, 'Агап Блинов')).toBe(
      'назначить курьера Агап Блинов',
    );
    expect(describeAction({ kind: 'courier', courierId: null })).toBe('снять курьера');
  });
});

function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'about:blank',
    title: 'x',
    status,
    detail: 'x',
    instance: '/api/orders/196',
    code,
    ...extra,
  };
}

describe('versionConflictOf — ответ 412', () => {
  it('достаёт актуальный заказ и последнее изменение', () => {
    const current = makeOrder({ status: 'preparing', version: 3 });
    const lastChange = makeEvent();
    const error = new ApiError(412, problem(412, 'VERSION_CONFLICT', { current, lastChange }));
    expect(versionConflictOf(error)).toMatchObject({ current, lastChange });
  });

  it('другие ошибки и 412 с телом не по контракту — не конфликт', () => {
    expect(versionConflictOf(new ApiError(409, problem(409, 'COURIER_LIMIT_REACHED')))).toBeNull();
    expect(versionConflictOf(new ApiError(412, problem(412, 'VERSION_CONFLICT')))).toBeNull();
    expect(versionConflictOf(new Error('x'))).toBeNull();
  });
});

describe('fieldError — ошибка конкретного поля из 400', () => {
  it('сообщение API для поля по JSON Pointer', () => {
    const error = new ApiError(
      400,
      problem(400, 'VALIDATION_FAILED', {
        errors: [{ location: 'body', path: '/reason', message: 'Слишком длинная причина' }],
      }),
    );
    expect(fieldError(error, '/reason')).toBe('Слишком длинная причина');
    expect(fieldError(error, '/other')).toBeNull();
    expect(fieldError(new ApiError(409, problem(409, 'X')), '/reason')).toBeNull();
  });
});
