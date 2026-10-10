import {
  checkCourierChange,
  checkStatusChange,
  courierHasCapacity,
  isActiveDelivery,
  MAX_ACTIVE_DELIVERIES_PER_COURIER,
  type BusinessRuleCode,
  type Order,
  type OrderEvent,
  type OrderStatus,
} from '@foodster/shared';
import type { Database } from '../../db/client';
import type { orderEvents } from '../../db/schema';
import {
  AppError,
  conflict,
  notFound,
  preconditionFailed,
  preconditionRequired,
} from '../../errors';
import { ifMatchSatisfied, parseIfMatch } from '../../http/etag';
import { toOrderDto, toOrderEventDto } from './orders.mapper';
import * as repository from './orders.repository';

const RULE_MESSAGES: Record<BusinessRuleCode, string> = {
  TRANSITION_NOT_ALLOWED: 'Такой переход статуса недоступен',
  COURIER_REQUIRED: 'Сначала назначьте курьера: без него заказ нельзя передать в доставку',
  COURIER_NOT_EDITABLE: 'Курьера уже нельзя сменить: заказ передан в доставку или завершён',
  COURIER_LIMIT_REACHED: `У курьера уже максимум активных доставок: ${MAX_ACTIVE_DELIVERIES_PER_COURIER}`,
};

function ruleViolation(code: BusinessRuleCode, extensions: Record<string, unknown> = {}): AppError {
  return conflict(code, RULE_MESSAGES[code], extensions);
}

// Отмена — тоже переход FSM, но оператору нужен понятный текст, а не общий про переходы.
const CANCEL_NOT_ALLOWED_MESSAGE = 'Заказ уже передан курьеру или завершён — отменить нельзя';

function courierNotFound(courierId: number): AppError {
  return new AppError(404, 'COURIER_NOT_FOUND', `Курьер ${courierId} не найден`);
}

export interface MutationTarget {
  orderId: number;
  ifMatch: string | undefined;
  actorId: number;
}

// Что поменять в заказе и какую запись добавить в audit.
interface Mutation {
  change: repository.OrderChange;
  event: Omit<typeof orderEvents.$inferInsert, 'orderId' | 'actorId' | 'orderVersion'>;
}

type Decide = (
  tx: repository.Transaction,
  order: repository.OrderRow,
) => Mutation | null | Promise<Mutation | null>;

// Результат изменения: заказ и запись audit. event = null — ничего не изменилось (no-op):
// публиковать событие об изменении (этап 6b) в этом случае не нужно.
export interface MutationResult {
  order: Order;
  event: OrderEvent | null;
}

// 412 с актуальным состоянием и последним изменением: фронт покажет, кто и когда изменил заказ.
async function versionConflict(tx: repository.Transaction, orderId: number): Promise<AppError> {
  const current = await repository.findOrderById(tx, orderId);
  const lastChange = await repository.findLastOrderEvent(tx, orderId);
  return preconditionFailed('Заказ уже изменил другой оператор. Обновите данные и повторите действие', {
    current: current ? toOrderDto(current) : null,
    lastChange: lastChange ? toOrderEventDto(lastChange) : null,
  });
}

// Общий каркас любого изменения заказа — одна транзакция:
// 1) If-Match обязателен (428), версия должна совпасть (412);
// 2) бизнес-правила решают, что меняется (409);
// 3) запись через compare-and-set по версии + запись audit — атомарно.
async function mutateOrder(
  db: Database,
  target: MutationTarget,
  decide: Decide,
): Promise<MutationResult> {
  const condition = parseIfMatch(target.ifMatch);
  if (!condition) throw preconditionRequired();

  return db.transaction(async (tx) => {
    const order = await repository.findOrderById(tx, target.orderId);
    if (!order) throw notFound(`Заказ ${target.orderId} не найден`);
    if (!ifMatchSatisfied(condition, order.version)) throw await versionConflict(tx, order.id);

    const mutation = await decide(tx, order);
    // Ничего не меняется (например, назначили того же курьера): версия и audit прежние.
    if (!mutation) return { order: toOrderDto(order), event: null };

    const version = await repository.applyOrderChange(tx, order.id, order.version, mutation.change);
    // Между чтением и записью заказ успел изменить кто-то другой — его изменения не затираем.
    if (version === undefined) throw await versionConflict(tx, order.id);

    await repository.insertOrderEvent(tx, {
      ...mutation.event,
      orderId: order.id,
      actorId: target.actorId,
      orderVersion: version,
    });
    const changed = await repository.findOrderById(tx, order.id);
    const event = await repository.findLastOrderEvent(tx, order.id);
    if (!changed || !event) throw notFound(`Заказ ${order.id} не найден`);
    return { order: toOrderDto(changed), event: toOrderEventDto(event) };
  });
}

// Лимит активных доставок. Строка курьера блокируется до конца транзакции, поэтому
// два одновременных назначения одному курьеру проверяются по очереди, а не параллельно.
async function ensureCourierCapacity(
  tx: repository.Transaction,
  courierId: number,
  orderId: number,
): Promise<void> {
  const courier = await repository.lockCourier(tx, courierId);
  if (!courier) throw courierNotFound(courierId);
  const activeDeliveries = await repository.countActiveDeliveries(tx, courierId, orderId);
  if (!courierHasCapacity(activeDeliveries)) {
    throw ruleViolation('COURIER_LIMIT_REACHED', {
      courier,
      activeDeliveries,
      limit: MAX_ACTIVE_DELIVERIES_PER_COURIER,
    });
  }
}

export function changeOrderStatus(
  db: Database,
  target: MutationTarget,
  to: Exclude<OrderStatus, 'cancelled'>,
): Promise<MutationResult> {
  return mutateOrder(db, target, async (tx, order) => {
    const check = checkStatusChange(order, to);
    if (!check.ok) throw ruleViolation(check.code);
    // Заказ становится активной доставкой своего курьера (сейчас это переход в ready) —
    // проверяем лимит. Список активных статусов берём из shared, а не хардкодим.
    const becomesActive = isActiveDelivery(to) && !isActiveDelivery(order.status);
    if (becomesActive && order.courierId !== null) {
      await ensureCourierCapacity(tx, order.courierId, order.id);
    }
    return {
      change: { status: to },
      event: { action: 'status_changed', fromStatus: order.status, toStatus: to },
    };
  });
}

export function changeOrderCourier(
  db: Database,
  target: MutationTarget,
  courierId: number | null,
): Promise<MutationResult> {
  return mutateOrder(db, target, async (tx, order) => {
    const check = checkCourierChange(order);
    if (!check.ok) throw ruleViolation(check.code);
    if (courierId === order.courierId) return null;

    if (courierId !== null) {
      if (isActiveDelivery(order.status)) {
        await ensureCourierCapacity(tx, courierId, order.id);
      } else if (!(await repository.lockCourier(tx, courierId))) {
        throw courierNotFound(courierId);
      }
    }
    const action =
      order.courierId === null
        ? 'courier_assigned'
        : courierId === null
          ? 'courier_unassigned'
          : 'courier_changed';
    return {
      change: { courierId },
      event: { action, fromCourierId: order.courierId, toCourierId: courierId },
    };
  });
}

export function cancelOrder(
  db: Database,
  target: MutationTarget,
  reason: string | null,
): Promise<MutationResult> {
  return mutateOrder(db, target, (_tx, order) => {
    const check = checkStatusChange(order, 'cancelled');
    if (!check.ok) throw conflict(check.code, CANCEL_NOT_ALLOWED_MESSAGE);
    // Курьер остаётся в заказе для истории; отменённый заказ не считается активной доставкой.
    return {
      change: { status: 'cancelled' },
      event: { action: 'cancelled', fromStatus: order.status, toStatus: 'cancelled', reason },
    };
  });
}
