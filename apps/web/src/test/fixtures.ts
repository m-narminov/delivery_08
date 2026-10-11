import type { Order, OrderEvent } from '@foodster/shared';

// Заказ для тестов: всё, что не задано явно, — правдоподобное значение по умолчанию.
export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 196,
    status: 'accepted',
    customerName: 'Ковалева Ангелина',
    customerPhone: '+79749468265',
    deliveryAddress: 'г. Москва, Студенческая наб., д. 136, кв. 157',
    amountMinor: 210_000,
    restaurant: { id: 1, name: 'Поке Бар' },
    courier: null,
    version: 2,
    createdAt: '2026-10-11T10:14:00.000Z',
    updatedAt: '2026-10-11T10:20:00.000Z',
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<OrderEvent> = {}): OrderEvent {
  return {
    id: 1,
    action: 'status_changed',
    fromStatus: 'accepted',
    toStatus: 'preparing',
    fromCourier: null,
    toCourier: null,
    reason: null,
    actor: { id: 2, name: 'Мария Иванова' },
    orderVersion: 3,
    createdAt: '2026-10-11T10:30:00.000Z',
    ...overrides,
  };
}
