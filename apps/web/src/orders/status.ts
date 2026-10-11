import type { OrderStatus } from '@foodster/shared';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Новый',
  accepted: 'Принят',
  preparing: 'Готовится',
  ready: 'Готов к выдаче',
  picked_up: 'У курьера',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};

// Цвета значков (вариант light: текст оттенком 9 на фоне оттенка 1, в тёмной теме — оттенок 0
// на затемнённом 9). Выбраны цвета, у которых этот контраст не ниже 4,5 (WCAG AA) в обеих
// темах; в светлой теме не проходят жёлтый (2,69), оранжевый (3,62), зелёный (3,81),
// лаймовый (3,33) и бирюзовый (4,33). Цвет — не единственный признак: на значке всегда текст.
export const STATUS_COLORS: Record<OrderStatus, string> = {
  new: 'blue',
  accepted: 'cyan',
  preparing: 'indigo',
  ready: 'grape',
  picked_up: 'violet',
  delivered: 'foodsterGreen',
  cancelled: 'gray',
};
