import { describe, expect, it } from 'vitest';
import { courierHasCapacity, isActiveDelivery } from './order-rules';
import { ORDER_STATUSES } from './order-status';

describe('isActiveDelivery', () => {
  it('активные доставки — только ready и picked_up', () => {
    expect(ORDER_STATUSES.filter(isActiveDelivery)).toEqual(['ready', 'picked_up']);
  });
});

describe('courierHasCapacity', () => {
  it.each([
    [0, true],
    [2, true],
    [3, false],
    [4, false],
  ] as const)('активных доставок %i → можно ещё: %s', (active, expected) => {
    expect(courierHasCapacity(active)).toBe(expected);
  });
});
