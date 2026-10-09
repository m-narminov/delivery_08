import { isCourierEditable } from './order-rules';
import type { OrderStatus } from './order-status';

// Таблица переходов — единственный источник правды о жизненном цикле заказа.
// satisfies проверяет, что описаны все статусы и нет опечаток, не теряя литеральных типов.
const TRANSITIONS = {
  new: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['picked_up', 'cancelled'],
  picked_up: ['delivered'],
  delivered: [],
  cancelled: [],
} as const satisfies Record<OrderStatus, readonly OrderStatus[]>;

export type BusinessRuleCode =
  'TRANSITION_NOT_ALLOWED' | 'COURIER_REQUIRED' | 'COURIER_NOT_EDITABLE' | 'COURIER_LIMIT_REACHED';

export type RuleCheck = { ok: true } | { ok: false; code: BusinessRuleCode };

const OK: RuleCheck = { ok: true };

export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return allowedTransitions(from).includes(to);
}

export function canCancel(status: OrderStatus): boolean {
  return canTransition(status, 'cancelled');
}

// Следующий шаг по основной цепочке (без отмены); null — дальше идти некуда.
export function nextStatus(from: OrderStatus): OrderStatus | null {
  return allowedTransitions(from).find((to) => to !== 'cancelled') ?? null;
}

export function isTerminal(status: OrderStatus): boolean {
  return allowedTransitions(status).length === 0;
}

// Правила, которые проверяются по самому заказу. Лимит активных доставок курьера
// требует подсчёта в БД под блокировкой, поэтому его проверяет сервис API.
export function checkStatusChange(
  order: { status: OrderStatus; courierId: number | null },
  to: OrderStatus,
): RuleCheck {
  if (!canTransition(order.status, to)) {
    return { ok: false, code: 'TRANSITION_NOT_ALLOWED' };
  }
  if (to === 'picked_up' && order.courierId === null) {
    return { ok: false, code: 'COURIER_REQUIRED' };
  }
  return OK;
}

export function checkCourierChange(order: { status: OrderStatus }): RuleCheck {
  return isCourierEditable(order.status) ? OK : { ok: false, code: 'COURIER_NOT_EDITABLE' };
}
