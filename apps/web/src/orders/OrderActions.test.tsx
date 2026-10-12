import type { Courier, Order } from '@foodster/shared';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { couriersQuery } from '../api/orders';
import { makeOrder } from '../test/fixtures';
import { OrderActions } from './OrderActions';
import type { useOrderActions } from './useOrderActions';

type Actions = ReturnType<typeof useOrderActions>;

// Причина отмены не короче 30 символов (здесь 42).
const REASON = 'Клиент передумал и попросил отменить заказ';

// Действия — заглушка: здесь проверяется, что панель показывает и что вызывает, а не запросы.
function makeActions(overrides: Partial<Actions> = {}): Actions {
  return {
    run: vi.fn(),
    isPending: false,
    pendingAction: null,
    retrying: false,
    lastAction: null,
    error: null,
    resetError: vi.fn(),
    conflict: null,
    refresh: vi.fn(),
    retry: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

const couriers: Courier[] = [
  { id: 7, name: 'Агап Блинов', phone: '+79000000007', activeDeliveries: 3 },
  { id: 8, name: 'Акулина Лазарева', phone: '+79000000008', activeDeliveries: 1 },
];

// rerenderWith — тот же экземпляр панели с новым заказом или версией (как после обновления
// карточки по SSE).
function renderPanel(order: Order, actions = makeActions(), etag: string | null = '"v2"') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(couriersQuery.queryKey, couriers);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MantineProvider>
  );
  const view = render(<OrderActions order={order} etag={etag} actions={actions} />, { wrapper });
  const rerenderWith = (next: { order?: Order; etag?: string | null; actions?: Actions }) => {
    view.rerender(
      <OrderActions
        order={next.order ?? order}
        etag={next.etag === undefined ? etag : next.etag}
        actions={next.actions ?? actions}
      />,
    );
  };
  return Object.assign(actions, { rerenderWith });
}

// Кнопка подтверждения внутри модалки отмены (снаружи есть кнопка с той же подписью).
function confirmCancelButton(): HTMLButtonElement {
  const dialog = screen.getByRole('dialog', { name: 'Отменить заказ?' });
  const button = Array.from(dialog.querySelectorAll('button')).find(
    (item) => item.textContent === 'Отменить заказ',
  );
  if (!button) throw new Error('нет кнопки подтверждения');
  return button;
}

describe('OrderActions — только допустимые действия', () => {
  it('следующий статус: кнопка отправляет переход с версией карточки', async () => {
    const user = userEvent.setup();
    const actions = renderPanel(makeOrder({ status: 'accepted' }));
    await user.click(screen.getByRole('button', { name: 'Перевести в «Готовится»' }));
    expect(actions.run).toHaveBeenCalledWith({ kind: 'transition', to: 'preparing' }, '"v2"');
  });

  it('«У курьера» без курьера — недоступно, подсказка связана с кнопкой', () => {
    renderPanel(makeOrder({ status: 'ready' }));
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Перевести в «У курьера»',
    });
    expect(button.disabled).toBe(true);
    // Подсказка связана с кнопкой: диктор прочтёт её вместе с кнопкой.
    const hint = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Сначала назначьте курьера');
  });

  it('перед «Готов к выдаче» — предупреждение, если у курьера уже 3 из 3', () => {
    renderPanel(makeOrder({ status: 'preparing', courier: { id: 7, name: 'Агап Блинов' } }));
    // getByText сам падает, если текста нет.
    screen.getByText('У курьера уже 3 из 3 активных доставок — переход отклонят');
  });

  it('забранный заказ: отменить и сменить курьера уже нельзя', () => {
    renderPanel(makeOrder({ status: 'picked_up', courier: { id: 8, name: 'Акулина Лазарева' } }));
    const next = screen.getByRole<HTMLButtonElement>('button', { name: 'Перевести в «Доставлен»' });
    expect(next.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Отменить заказ' })).toBeNull();
    // У Select роль combobox.
    expect(screen.queryByRole('combobox', { name: 'Курьер' })).toBeNull();
  });

  it('конечный статус — действий нет', () => {
    renderPanel(makeOrder({ status: 'delivered', courier: { id: 8, name: 'Акулина Лазарева' } }));
    screen.getByText('Заказ доставлен — действий больше нет.');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('пока идёт изменение, всё недоступно', () => {
    renderPanel(
      makeOrder({ status: 'accepted' }),
      makeActions({ isPending: true, pendingAction: { kind: 'cancel', reason: REASON } }),
    );
    const disabled = (name: string) =>
      screen.getByRole<HTMLButtonElement>('button', { name }).disabled;
    expect(disabled('Перевести в «Готовится»')).toBe(true);
    expect(disabled('Отменить заказ')).toBe(true);
  });

  it('ошибка правила (409) — текст сервера в панели', () => {
    const error = new ApiError(409, {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'У курьера уже максимум активных доставок: 3',
      instance: '/api/orders/196/courier',
      code: 'COURIER_LIMIT_REACHED',
    });
    renderPanel(
      makeOrder({ status: 'ready' }),
      makeActions({ error, lastAction: { kind: 'courier', courierId: 7 } }),
    );
    screen.getByText('Не получилось');
    screen.getByText('У курьера уже максимум активных доставок: 3');
  });
});

describe('отмена с причиной', () => {
  it('причина уходит обрезанной, с версией на момент открытия — даже если карточка обновилась', async () => {
    const user = userEvent.setup();
    const order = makeOrder({ status: 'accepted' });
    const actions = renderPanel(order);
    await user.click(screen.getByRole('button', { name: 'Отменить заказ' }));
    await user.type(await screen.findByRole('textbox', { name: 'Причина' }), `  ${REASON} `);
    // Счётчик — по всему тексту (как maxLength): 2 + 42 + 1.
    screen.getByText(/45 из 2000$/);
    // Пока оператор писал причину, карточка обновилась (SSE): новая версия.
    actions.rerenderWith({ order: { ...order, version: 3 }, etag: '"v3"' });
    await user.click(confirmCancelButton());
    expect(actions.run).toHaveBeenCalledWith({ kind: 'cancel', reason: REASON }, '"v2"');
  });

  it('причина короче 30 символов не уходит: подсказка у поля, пропадает, когда длины хватает', async () => {
    const user = userEvent.setup();
    const actions = renderPanel(makeOrder({ status: 'accepted' }));
    await user.click(screen.getByRole('button', { name: 'Отменить заказ' }));
    const field = await screen.findByRole('textbox', { name: 'Причина' });
    expect(field).toHaveProperty('required', true);
    // Пробелы по краям не считаются: 16 символов.
    await user.type(field, '  Клиент передумал');
    await user.click(confirmCancelButton());
    expect(actions.run).not.toHaveBeenCalled();
    screen.getByText('Не короче 30 символов — сейчас 16');
    // Фокус — обратно в поле: ошибка связана с ним, диктор её прочтёт.
    expect(document.activeElement).toBe(field);

    await user.type(field, ' и попросил отменить заказ');
    expect(screen.queryByText(/Не короче 30 символов — сейчас/)).toBeNull();
    await user.click(confirmCancelButton());
    expect(actions.run).toHaveBeenCalledWith({ kind: 'cancel', reason: REASON }, '"v2"');
  });

  it('подсказка о короткой причине не остаётся после закрытия модалки', async () => {
    const user = userEvent.setup();
    renderPanel(makeOrder({ status: 'accepted' }));
    await user.click(screen.getByRole('button', { name: 'Отменить заказ' }));
    await user.type(await screen.findByRole('textbox', { name: 'Причина' }), 'Коротко');
    await user.click(confirmCancelButton());
    screen.getByText('Не короче 30 символов — сейчас 7');

    await user.click(screen.getByRole('button', { name: 'Не отменять' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Отменить заказ' }));
    await screen.findByRole('dialog', { name: 'Отменить заказ?' });
    expect(screen.queryByText(/Не короче 30 символов — сейчас/)).toBeNull();
  });

  it('ошибка отмены — внутри модалки (причина не теряется), а не в панели', async () => {
    const user = userEvent.setup();
    const actions = renderPanel(makeOrder({ status: 'accepted' }));
    await user.click(screen.getByRole('button', { name: 'Отменить заказ' }));
    await user.type(await screen.findByRole('textbox', { name: 'Причина' }), REASON);
    const error = new ApiError(409, {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'Заказ уже передан курьеру или завершён — отменить нельзя',
      instance: '/api/orders/196/cancel',
      code: 'TRANSITION_NOT_ALLOWED',
    });
    actions.rerenderWith({
      actions: { ...actions, error, lastAction: { kind: 'cancel', reason: REASON } },
    });
    const dialog = screen.getByRole('dialog', { name: 'Отменить заказ?' });
    expect(dialog.textContent).toContain(
      'Заказ уже передан курьеру или завершён — отменить нельзя',
    );
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Причина' }).value).toBe(
      REASON,
    );
    expect(screen.queryByText('Не получилось')).toBeNull();
  });
});

describe('выбор курьера', () => {
  it('заказ «Готов к выдаче»: курьер с 3 из 3 недоступен', async () => {
    const user = userEvent.setup();
    renderPanel(makeOrder({ status: 'ready', version: 4 }), makeActions(), '"v4"');
    await user.click(screen.getByRole('combobox', { name: 'Курьер' }));
    const full = await screen.findByRole('option', { name: 'Агап Блинов — 3 из 3' });
    const free = screen.getByRole('option', { name: 'Акулина Лазарева — 1 из 3' });
    expect(
      full.getAttribute('aria-disabled') ?? full.getAttribute('data-combobox-disabled'),
    ).toBeTruthy();
    expect(free.getAttribute('data-combobox-disabled')).toBeNull();
  });

  it('заказ ещё готовится: курьер с 3 из 3 доступен (лимит проверят при «Готов к выдаче»)', async () => {
    const user = userEvent.setup();
    renderPanel(makeOrder({ status: 'preparing', version: 4 }), makeActions(), '"v4"');
    await user.click(screen.getByRole('combobox', { name: 'Курьер' }));
    const full = await screen.findByRole('option', { name: 'Агап Блинов — 3 из 3' });
    expect(full.getAttribute('data-combobox-disabled')).toBeNull();
  });

  it('новая версия заказа сбрасывает несохранённый выбор', async () => {
    const user = userEvent.setup();
    const order = makeOrder({ status: 'preparing', version: 4 });
    const actions = renderPanel(order, makeActions(), '"v4"');
    await user.click(screen.getByRole('combobox', { name: 'Курьер' }));
    await user.click(await screen.findByRole('option', { name: 'Акулина Лазарева — 1 из 3' }));
    screen.getByRole('button', { name: 'Назначить' });
    // Карточка обновилась (другой оператор что-то изменил): выбор привязан к старой версии.
    actions.rerenderWith({ order: { ...order, version: 5 }, etag: '"v5"' });
    expect(screen.queryByRole('button', { name: 'Назначить' })).toBeNull();
  });
});
