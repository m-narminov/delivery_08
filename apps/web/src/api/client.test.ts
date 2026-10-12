import { orderSchema } from '@foodster/shared';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { makeOrder } from '../test/fixtures';
import { ApiError, apiRequest, NetworkError } from './client';
import { errorMessage } from './errors';

function stubFetch(response: Response | Error) {
  const fetch = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('apiRequest', () => {
  it('проверяет ответ схемой и отдаёт ETag; If-Match и тело уходят как заданы', async () => {
    const order = makeOrder();
    const fetch = stubFetch(
      new Response(JSON.stringify(order), {
        headers: { 'content-type': 'application/json', etag: '"v2"' },
      }),
    );
    const result = await apiRequest('/api/orders/196/transitions', orderSchema, {
      method: 'POST',
      body: { to: 'preparing' },
      ifMatch: '"v2"',
    });
    expect(result).toEqual({ data: order, etag: '"v2"' });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'if-match': '"v2"', 'content-type': 'application/json' });
    expect(init.body).toBe('{"to":"preparing"}');
  });

  it('ошибка API — ApiError с кодом и русским текстом из problem+json', async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: 'У курьера уже максимум активных доставок: 3',
          instance: '/api/orders/45/courier',
          code: 'COURIER_LIMIT_REACHED',
        }),
        { status: 409, headers: { 'content-type': 'application/problem+json' } },
      ),
    );
    const error = await apiRequest('/x', orderSchema).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem?.code).toBe('COURIER_LIMIT_REACHED');
    expect(errorMessage(error)).toBe('У курьера уже максимум активных доставок: 3');
  });

  it('нет связи — NetworkError и понятный текст', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    const error = await apiRequest('/x', orderSchema).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect(errorMessage(error)).toBe('Нет связи с сервером. Проверьте подключение');
  });

  it('ответ не по контракту — ошибка сразу, а не где-то в компоненте', async () => {
    stubFetch(new Response(JSON.stringify({ id: 'не число' }), { status: 200 }));
    await expect(apiRequest('/x', orderSchema)).rejects.toBeInstanceOf(ZodError);
  });
});
