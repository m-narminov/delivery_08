import { describe, expect, it } from 'vitest';
import { makeEvent } from '../test/fixtures';
import { describeEvent, eventActorName } from './events';

const anna = { id: 3, name: 'Анна' };
const boris = { id: 4, name: 'Борис' };

describe('describeEvent — строка истории для каждого действия', () => {
  it.each([
    [makeEvent({ action: 'created', fromStatus: null, toStatus: 'new' }), 'Заказ создан'],
    [makeEvent({ action: 'status_changed' }), 'Принят → Готовится'],
    [makeEvent({ action: 'courier_assigned', toCourier: anna }), 'Назначен курьер Анна'],
    [
      makeEvent({ action: 'courier_changed', fromCourier: anna, toCourier: boris }),
      'Курьер: Анна → Борис',
    ],
    [makeEvent({ action: 'courier_unassigned', fromCourier: anna }), 'Курьер Анна снят с заказа'],
    [
      makeEvent({ action: 'cancelled', fromStatus: 'ready', toStatus: 'cancelled' }),
      'Заказ отменён (был: Готов к выдаче)',
    ],
  ])('%#: %s', (event, text) => {
    expect(describeEvent(event)).toBe(text);
  });
});

describe('eventActorName', () => {
  it('без автора — клиентское приложение', () => {
    expect(eventActorName(makeEvent({ actor: null }))).toBe('Клиентское приложение');
    expect(eventActorName(makeEvent())).toBe('Мария Иванова');
  });
});
