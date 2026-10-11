import {
  badRequestProblemSchema,
  canCancel,
  checkCourierChange,
  checkStatusChange,
  versionConflictProblemSchema,
  type Order,
  type VersionConflictProblem,
} from '@foodster/shared';
import type { OrderAction } from '../api/orders';
import { ApiError } from '../api/client';
import { STATUS_LABELS } from './status';

// Можно ли выполнить действие над заказом в его текущем состоянии. Те же правила из shared,
// что проверяет API, — кнопки показывают ровно допустимое. Лимит курьера сюда не входит:
// его считает API под блокировкой, фронт лишь подсказывает по счётчику.
export function isActionAllowed(order: Order, action: OrderAction): boolean {
  switch (action.kind) {
    case 'transition':
      return checkStatusChange(
        { status: order.status, courierId: order.courier?.id ?? null },
        action.to,
      ).ok;
    case 'courier':
      return checkCourierChange(order).ok && action.courierId !== (order.courier?.id ?? null);
    case 'cancel':
      return canCancel(order.status);
  }
}

// Что пытался сделать оператор — для модалки конфликта.
export function describeAction(action: OrderAction, courierName?: string): string {
  switch (action.kind) {
    case 'transition':
      return `перевести заказ в статус «${STATUS_LABELS[action.to]}»`;
    case 'courier':
      return action.courierId === null
        ? 'снять курьера'
        : `назначить курьера${courierName ? ` ${courierName}` : ''}`;
    case 'cancel':
      return 'отменить заказ';
  }
}

// Ответ 412: заказ уже изменил другой оператор. В теле — актуальный заказ и последнее изменение.
export function versionConflictOf(error: unknown): VersionConflictProblem | null {
  if (!(error instanceof ApiError) || error.status !== 412) return null;
  const result = versionConflictProblemSchema.safeParse(error.problem);
  return result.success ? result.data : null;
}

// Другой оператор уже сделал то же самое (тот же статус, тот же курьер, уже отменён): результат,
// которого хотели, есть — повторять нечего.
export function isAlreadyDone(order: Order, action: OrderAction): boolean {
  switch (action.kind) {
    case 'transition':
      return order.status === action.to;
    case 'courier':
      return (order.courier?.id ?? null) === action.courierId;
    case 'cancel':
      return order.status === 'cancelled';
  }
}

// Сообщение API для одного поля из ответа 400 VALIDATION_FAILED (path — JSON Pointer, '/reason').
export function fieldError(error: unknown, path: string): string | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null;
  const result = badRequestProblemSchema.safeParse(error.problem);
  return result.success
    ? (result.data.errors?.find((issue) => issue.path === path)?.message ?? null)
    : null;
}
