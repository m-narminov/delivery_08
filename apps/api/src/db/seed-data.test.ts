import {
  canTransition,
  isActiveDelivery,
  MAX_ACTIVE_DELIVERIES_PER_COURIER,
} from '@foodster/shared';
import { describe, expect, it } from 'vitest';
import { ENGLISH_ADDRESS_EVERY, generateSeedData, SEED_COUNTS } from './seed-data';

const NOW = new Date('2026-10-10T12:00:00Z');
const data = generateSeedData(NOW);

describe('generateSeedData', () => {
  it('детерминирован: одинаковый результат при одинаковом now', () => {
    expect(generateSeedData(NOW)).toEqual(data);
  });

  it('создаёт нужное количество записей', () => {
    expect(data.restaurants).toHaveLength(SEED_COUNTS.restaurants);
    expect(data.couriers).toHaveLength(SEED_COUNTS.couriers);
    expect(data.operators).toHaveLength(SEED_COUNTS.operators);
    expect(data.orders).toHaveLength(SEED_COUNTS.orders);
  });

  it('покрывает все статусы', () => {
    expect(new Set(data.orders.map((order) => order.status)).size).toBe(7);
  });

  it('каждый 10-й адрес — латиницей, остальные — по-русски', () => {
    const latin = data.orders.filter((order) => !/[а-яё]/i.test(order.deliveryAddress));
    expect(latin).toHaveLength(SEED_COUNTS.orders / ENGLISH_ADDRESS_EVERY);
    expect(latin.every((order) => order.deliveryAddress.startsWith('Moscow, '))).toBe(true);
  });

  it('у курьера не больше 3 активных доставок', () => {
    const active = new Map<number, number>();
    for (const order of data.orders) {
      if (order.courier !== null && isActiveDelivery(order.status)) {
        active.set(order.courier, (active.get(order.courier) ?? 0) + 1);
      }
    }
    expect(Math.max(...active.values())).toBeLessThanOrEqual(MAX_ACTIVE_DELIVERIES_PER_COURIER);
  });

  it('телефоны клиентов и курьеров — российские мобильные в формате E.164: +79 и 9 цифр', () => {
    const phones = [
      ...data.orders.map((order) => order.customerPhone),
      ...data.couriers.map((courier) => courier.phone),
    ];
    for (const phone of phones) expect(phone).toMatch(/^\+79\d{9}$/);
  });

  it('picked_up и delivered всегда с курьером', () => {
    const withoutCourier = data.orders.filter(
      (order) =>
        (order.status === 'picked_up' || order.status === 'delivered') && order.courier === null,
    );
    expect(withoutCourier).toEqual([]);
  });

  it('история заказа проходит только по разрешённым переходам FSM', () => {
    for (const order of data.orders) {
      const statusEvents = order.events.filter((event) => event.toStatus !== null);
      expect(statusEvents[0]?.action).toBe('created');
      for (const event of statusEvents.slice(1)) {
        expect(event.fromStatus).not.toBeNull();
        expect(canTransition(event.fromStatus ?? 'new', event.toStatus ?? 'new')).toBe(true);
      }
      expect(statusEvents.at(-1)?.toStatus).toBe(order.status);
    }
  });

  it('version равен числу событий, время событий не убывает и не в будущем', () => {
    for (const order of data.orders) {
      expect(order.version).toBe(order.events.length);
      const times = order.events.map((event) => event.at.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(order.updatedAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });
});
