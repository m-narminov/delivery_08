import type { OrderStatus } from './order-status';

// Активные доставки — заказы, которые курьер уже везёт или вот-вот заберёт.
export const ACTIVE_DELIVERY_STATUSES = [
  'ready',
  'picked_up',
] as const satisfies readonly OrderStatus[];

export const MAX_ACTIVE_DELIVERIES_PER_COURIER = 3;

// Курьера можно назначить, сменить или снять, пока заказ не забран.
export const COURIER_EDITABLE_STATUSES = [
  'new',
  'accepted',
  'preparing',
  'ready',
] as const satisfies readonly OrderStatus[];

// Причина отмены обязательна и содержательна: «ошибка» или «клиент» в журнале ничего не объясняют.
export const CANCEL_REASON_MIN_LENGTH = 30;
export const CANCEL_REASON_MAX_LENGTH = 2000;

// Расширение до readonly OrderStatus[] безопасно: readonly-массивы ковариантны.
const activeDeliveryStatuses: readonly OrderStatus[] = ACTIVE_DELIVERY_STATUSES;
const courierEditableStatuses: readonly OrderStatus[] = COURIER_EDITABLE_STATUSES;

export function isActiveDelivery(status: OrderStatus): boolean {
  return activeDeliveryStatuses.includes(status);
}

export function isCourierEditable(status: OrderStatus): boolean {
  return courierEditableStatuses.includes(status);
}

export function courierHasCapacity(activeDeliveries: number): boolean {
  return activeDeliveries < MAX_ACTIVE_DELIVERIES_PER_COURIER;
}
