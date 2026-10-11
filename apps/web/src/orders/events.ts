import type { OrderEvent } from '@foodster/shared';
import { STATUS_LABELS } from './status';

// Имя курьера в записи истории. По типу курьера может не быть (у записи о смене статуса его
// и нет), но у действий с курьером он есть всегда: так их пишет API (назначение — с новым
// курьером, снятие — с прежним, смена — с обоими), а внешний ключ не даёт удалить курьера,
// упомянутого в истории. Прочерк — на случай расхождения данных, а не штатная ветка.
function courierName(courier: OrderEvent['fromCourier']): string {
  return courier?.name ?? '—';
}

// Что произошло — одной строкой для истории изменений заказа.
export function describeEvent(event: OrderEvent): string {
  switch (event.action) {
    case 'created':
      return 'Заказ создан';
    case 'status_changed':
      return event.fromStatus && event.toStatus
        ? `${STATUS_LABELS[event.fromStatus]} → ${STATUS_LABELS[event.toStatus]}`
        : 'Статус изменён';
    case 'courier_assigned':
      return `Назначен курьер ${courierName(event.toCourier)}`;
    case 'courier_changed':
      return `Курьер: ${courierName(event.fromCourier)} → ${courierName(event.toCourier)}`;
    case 'courier_unassigned':
      return `Курьер ${courierName(event.fromCourier)} снят с заказа`;
    case 'cancelled':
      return event.fromStatus
        ? `Заказ отменён (был: ${STATUS_LABELS[event.fromStatus]})`
        : 'Заказ отменён';
  }
}

// Кто сделал изменение. Без автора — действие не оператора: заказ создало клиентское приложение.
export function eventActorName(event: OrderEvent): string {
  return event.actor?.name ?? 'Клиентское приложение';
}
