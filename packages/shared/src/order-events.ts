// Типы записей audit log заказа.
export const ORDER_EVENT_ACTIONS = [
  'created',
  'status_changed',
  'courier_assigned',
  'courier_changed',
  'courier_unassigned',
  'cancelled',
] as const;

export type OrderEventAction = (typeof ORDER_EVENT_ACTIONS)[number];
