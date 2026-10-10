import { fakerEN, fakerRU as faker } from '@faker-js/faker';
import {
  canCancel,
  courierHasCapacity,
  isActiveDelivery,
  nextStatus,
  ORDER_STATUSES,
  type OrderEventAction,
  type OrderStatus,
} from '@foodster/shared';

export const SEED_COUNTS = { restaurants: 20, couriers: 20, operators: 20, orders: 200 } as const;

// Фиксированное зерно: при каждом запуске генерируются одни и те же данные.
const RANDOM_SEED = 20261009;

const RESTAURANT_NAMES = [
  'Пицца на Арбате',
  'Суши Мастер',
  'Бургерная №1',
  'Хинкальная',
  'Вок и Лапша',
  'Шаурма Хаус',
  'Пекарня у дома',
  'Грузинский дворик',
  'Том Ям',
  'Паста Фреска',
  'Стейк Гриль',
  'Блинная',
  'Фалафель',
  'Пельменная',
  'Поке Бар',
  'Кофейня Зерно',
  'Тандыр',
  'Рамен Тайм',
  'Веган Кухня',
  'Чебуречная',
];

const CANCEL_REASONS = [
  'Клиент передумал',
  'Ресторан не может приготовить заказ',
  'Нет свободных курьеров',
  'Клиент не выходит на связь',
  null,
];

// Итоговый статус заказа: примерное распределение для правдоподобной картины.
const FINAL_STATUS_WEIGHTS = [
  { value: 'new', weight: 10 },
  { value: 'accepted', weight: 10 },
  { value: 'preparing', weight: 10 },
  { value: 'ready', weight: 12 },
  { value: 'picked_up', weight: 13 },
  { value: 'delivered', weight: 35 },
  { value: 'cancelled', weight: 10 },
] as const satisfies readonly { value: OrderStatus; weight: number }[];

const MINUTE_MS = 60_000;

// Каждый N-й заказ — с адресом латиницей (например, иностранный клиент): так видно,
// что поиск работает не только по-русски.
export const ENGLISH_ADDRESS_EVERY = 10;

function russianAddress(): string {
  const house = faker.number.int({ min: 1, max: 150 });
  const flat = faker.number.int({ min: 1, max: 300 });
  return `г. Москва, ${faker.location.street()}, д. ${house}, кв. ${flat}`;
}

function englishAddress(): string {
  return `Moscow, ${fakerEN.location.streetAddress()}, ${fakerEN.location.secondaryAddress()}`;
}

// Ссылки на справочники — индексы в массивах seed; реальные id появятся после вставки.
export interface SeedEvent {
  action: OrderEventAction;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  fromCourier: number | null;
  toCourier: number | null;
  reason: string | null;
  actor: number | null;
  at: Date;
}

export interface SeedOrder {
  status: OrderStatus;
  restaurant: number;
  courier: number | null;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  amountMinor: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  events: SeedEvent[];
}

export interface SeedData {
  restaurants: { name: string }[];
  couriers: { name: string; phone: string }[];
  operators: { name: string; email: string }[];
  orders: SeedOrder[];
}

// Основная цепочка выводится из FSM, а не дублируется: new → … → delivered.
function mainChain(): OrderStatus[] {
  const chain: OrderStatus[] = ['new'];
  for (let status = nextStatus('new'); status !== null; status = nextStatus(status)) {
    chain.push(status);
  }
  return chain;
}

const MAIN_CHAIN = mainChain();
const CANCELLABLE_STATUSES = ORDER_STATUSES.filter(canCancel);

function pathTo(finalStatus: OrderStatus, cancelledFrom: OrderStatus | null): OrderStatus[] {
  const last = cancelledFrom ?? finalStatus;
  const path = MAIN_CHAIN.slice(0, MAIN_CHAIN.indexOf(last) + 1);
  return cancelledFrom ? [...path, 'cancelled'] : path;
}

function pickCourier(activeByCourier: number[], needsCapacity: boolean): number | null {
  const candidates = activeByCourier
    .map((active, index) => ({ active, index }))
    .filter(({ active }) => !needsCapacity || courierHasCapacity(active))
    .map(({ index }) => index);
  return candidates.length > 0 ? faker.helpers.arrayElement(candidates) : null;
}

function generateOrder(now: Date, activeByCourier: number[], english: boolean): SeedOrder {
  let status: OrderStatus = faker.helpers.weightedArrayElement(FINAL_STATUS_WEIGHTS);
  const cancelledFrom =
    status === 'cancelled' ? faker.helpers.arrayElement(CANCELLABLE_STATUSES) : null;
  let path = pathTo(status, cancelledFrom);

  // Курьер обязателен с picked_up; пока заказ готовится, его назначают не всегда.
  const needsCourier = path.includes('picked_up');
  const mayHaveCourier = path.includes('preparing') && faker.datatype.boolean(0.6);
  let courier: number | null = null;
  if (needsCourier || mayHaveCourier) {
    courier = pickCourier(activeByCourier, isActiveDelivery(status));
    // Все курьеры заняты (3 активные доставки): заказ ждёт в ready без курьера.
    if (courier === null && status === 'picked_up') {
      status = 'ready';
      path = pathTo(status, null);
    }
  }
  if (courier !== null && isActiveDelivery(status)) {
    activeByCourier[courier] = (activeByCourier[courier] ?? 0) + 1;
  }
  const previousCourier =
    courier !== null && faker.datatype.boolean(0.15)
      ? faker.helpers.arrayElement(
          activeByCourier.map((_, index) => index).filter((i) => i !== courier),
        )
      : null;

  // Активные заказы — свежие (последние часы), завершённые — за последние две недели.
  const isRecent = !path.includes('delivered') && !path.includes('cancelled');
  const ageMinutes = isRecent
    ? faker.number.int({ min: 60, max: 240 })
    : faker.number.int({ min: 24 * 60, max: 14 * 24 * 60 });
  const maxGap = isRecent ? 8 : 20;
  const createdAt = new Date(now.getTime() - ageMinutes * MINUTE_MS);
  let time = createdAt.getTime();
  const tick = () => {
    time += faker.number.int({ min: 2, max: maxGap }) * MINUTE_MS;
    return new Date(time);
  };
  const operator = () => faker.number.int({ min: 0, max: SEED_COUNTS.operators - 1 });

  const event = (fields: Partial<SeedEvent> & Pick<SeedEvent, 'action' | 'at'>): SeedEvent => ({
    fromStatus: null,
    toStatus: null,
    fromCourier: null,
    toCourier: null,
    reason: null,
    actor: operator(),
    ...fields,
  });

  const events: SeedEvent[] = [
    event({ action: 'created', toStatus: 'new', actor: null, at: createdAt }),
  ];
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1] ?? 'new';
    const to = path[i] ?? 'new';
    if (to === 'cancelled') {
      events.push(
        event({
          action: 'cancelled',
          fromStatus: from,
          toStatus: to,
          reason: faker.helpers.arrayElement(CANCEL_REASONS),
          at: tick(),
        }),
      );
      continue;
    }
    events.push(event({ action: 'status_changed', fromStatus: from, toStatus: to, at: tick() }));
    // Курьера назначают, пока заказ готовится; иногда потом меняют.
    if (to === 'preparing' && courier !== null) {
      if (previousCourier !== null) {
        events.push(event({ action: 'courier_assigned', toCourier: previousCourier, at: tick() }));
        events.push(
          event({
            action: 'courier_changed',
            fromCourier: previousCourier,
            toCourier: courier,
            at: tick(),
          }),
        );
      } else {
        events.push(event({ action: 'courier_assigned', toCourier: courier, at: tick() }));
      }
    }
  }

  return {
    status,
    restaurant: faker.number.int({ min: 0, max: SEED_COUNTS.restaurants - 1 }),
    courier,
    customerName: faker.person.fullName(),
    customerPhone: faker.phone.number(),
    deliveryAddress: english ? englishAddress() : russianAddress(),
    amountMinor: faker.number.int({ min: 3, max: 50 }) * 10_000,
    createdAt,
    updatedAt: events.at(-1)?.at ?? createdAt,
    version: events.length,
    events,
  };
}

// Чистая функция: без БД и сети, поэтому её легко проверить в unit-тесте.
export function generateSeedData(now: Date): SeedData {
  faker.seed(RANDOM_SEED);
  fakerEN.seed(RANDOM_SEED);
  const restaurants = RESTAURANT_NAMES.map((name) => ({ name }));
  const couriers = Array.from({ length: SEED_COUNTS.couriers }, () => ({
    name: faker.person.fullName(),
    phone: faker.phone.number(),
  }));
  const operators = Array.from({ length: SEED_COUNTS.operators }, (_, index) => ({
    name: faker.person.fullName(),
    email: `operator${String(index + 1).padStart(2, '0')}@foodster.local`,
  }));
  const activeByCourier = couriers.map(() => 0);
  const orders = Array.from({ length: SEED_COUNTS.orders }, (_, index) =>
    generateOrder(now, activeByCourier, index % ENGLISH_ADDRESS_EVERY === 0),
  );
  return { restaurants, couriers, operators, orders };
}
