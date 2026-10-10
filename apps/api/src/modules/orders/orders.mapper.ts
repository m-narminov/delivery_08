import type { Order, OrderEvent } from '@foodster/shared';
import type { OrderEventRow, OrderRow } from './orders.repository';

// Ссылка {id, name} из колонок LEFT JOIN: если связи нет, обе колонки null.
function reference(id: number | null, name: string | null): { id: number; name: string } | null {
  return id === null || name === null ? null : { id, name };
}

// Строка БД → DTO ответа. Даты — ISO 8601 в UTC.
export function toOrderDto(row: OrderRow): Order {
  return {
    id: row.id,
    status: row.status,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    deliveryAddress: row.deliveryAddress,
    amountMinor: row.amountMinor,
    restaurant: { id: row.restaurantId, name: row.restaurantName },
    courier: reference(row.courierId, row.courierName),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toOrderEventDto(row: OrderEventRow): OrderEvent {
  return {
    id: row.id,
    action: row.action,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    fromCourier: reference(row.fromCourierId, row.fromCourierName),
    toCourier: reference(row.toCourierId, row.toCourierName),
    reason: row.reason,
    actor: reference(row.actorId, row.actorName),
    orderVersion: row.orderVersion,
    createdAt: row.createdAt.toISOString(),
  };
}
