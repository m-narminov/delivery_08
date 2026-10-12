import type { OrderEvent } from '@foodster/shared';
import { useEffect, useState } from 'react';
import { subscribeToOrderChanges } from '../api/stream';

// Сколько после чужого изменения кнопки действий недоступны: надпись кнопки могла смениться
// прямо под курсором («Готовится» → «Готов к выдаче»), и клик ушёл бы не туда.
const LOCK_AFTER_REMOTE_CHANGE_MS = 1_000;

// Последнее изменение этого заказа, пришедшее по SSE от другого оператора (по id автора;
// operatorId — оператор текущей сессии).
// Изменения под своим именем не показываем — включая сделанные в другой вкладке: обычно это
// то же действие, о котором здесь или там уже сказало уведомление «Статус: …» и т. п.
// Изменение без автора (клиентское приложение) показываем.
export function useRemoteChange(orderId: number, operatorId: number) {
  const [event, setEvent] = useState<OrderEvent | null>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    let unlockTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToOrderChanges((change) => {
      if (change.orderId !== orderId || change.event.actor?.id === operatorId) return;
      setEvent(change.event);
      setLocked(true);
      clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => setLocked(false), LOCK_AFTER_REMOTE_CHANGE_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(unlockTimer);
    };
  }, [orderId, operatorId]);
  return { event, locked, dismiss: () => setEvent(null) };
}
