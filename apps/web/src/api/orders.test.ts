import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeOrder } from '../test/fixtures';
import { orderQuery } from './orders';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('orderQuery — ответы не по порядку', () => {
  it('более старая версия заказа из запоздавшего ответа не затирает показанную новую', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const newer = { data: makeOrder({ version: 4 }), etag: '"v4"' };
    queryClient.setQueryData(orderQuery(196).queryKey, newer);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(makeOrder({ version: 3 })), {
            headers: { 'content-type': 'application/json', etag: '"v3"' },
          }),
        ),
      ),
    );

    await queryClient.fetchQuery({ ...orderQuery(196), staleTime: 0 });

    expect(queryClient.getQueryData(orderQuery(196).queryKey)).toEqual(newer);
    queryClient.clear();
  });

  it('новая версия заменяет старую как обычно', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(orderQuery(196).queryKey, {
      data: makeOrder({ version: 2 }),
      etag: '"v2"',
    });
    const fresh = makeOrder({ status: 'preparing', version: 3 });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(fresh), {
            headers: { 'content-type': 'application/json', etag: '"v3"' },
          }),
        ),
      ),
    );

    await queryClient.fetchQuery({ ...orderQuery(196), staleTime: 0 });

    expect(queryClient.getQueryData(orderQuery(196).queryKey)).toEqual({
      data: fresh,
      etag: '"v3"',
    });
    queryClient.clear();
  });
});
