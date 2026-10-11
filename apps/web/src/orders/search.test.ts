import { describe, expect, it } from 'vitest';
import {
  formatStatuses,
  hasFilters,
  ordersSearchSchema,
  parseStatuses,
  toApiQuery,
} from './search';

describe('статусы в адресе', () => {
  it('порядок — как в жизненном цикле, повторы и мусор отбрасываются', () => {
    expect(parseStatuses('ready, new,lost,new')).toEqual(['new', 'ready']);
    expect(formatStatuses(['ready', 'new'])).toBe('new,ready');
  });

  it('пусто — без фильтра', () => {
    expect(parseStatuses(undefined)).toEqual([]);
    expect(parseStatuses('')).toEqual([]);
    expect(formatStatuses([])).toBeUndefined();
  });
});

describe('ordersSearchSchema — адрес правит кто угодно', () => {
  it('без параметров — значения по умолчанию', () => {
    expect(ordersSearchSchema.parse({})).toEqual({
      sort: 'createdAt:desc',
      page: 1,
      pageSize: 20,
    });
  });

  it('мусор не ломает страницу, а становится значением по умолчанию', () => {
    expect(
      ordersSearchSchema.parse({
        status: 'lost',
        restaurantId: 'abc',
        sort: 'name:asc',
        page: '-3',
        pageSize: 33,
      }),
    ).toEqual({
      status: undefined,
      restaurantId: undefined,
      sort: 'createdAt:desc',
      page: 1,
      pageSize: 20,
    });
  });

  it('поиск: пробелы по краям обрезаются, пустой — без фильтра, число из адреса — строка', () => {
    expect(ordersSearchSchema.parse({ q: '  садовая 5 ' }).q).toBe('садовая 5');
    expect(ordersSearchSchema.parse({ q: '   ' }).q).toBeUndefined();
    // Роутер разбирает значения как JSON: ?q=12 пришёл бы числом.
    expect(ordersSearchSchema.parse({ q: 12 }).q).toBe('12');
  });

  it('поиск длиннее 200 символов отбрасывается, а не обрезается молча', () => {
    expect(ordersSearchSchema.parse({ q: 'а'.repeat(201) }).q).toBeUndefined();
  });
});

describe('toApiQuery и hasFilters', () => {
  it('в запрос к API — только заданные фильтры', () => {
    const search = ordersSearchSchema.parse({ status: 'ready,new', q: 'урожайная', page: 2 });
    expect(Object.fromEntries(new URLSearchParams(toApiQuery(search)))).toEqual({
      sort: 'createdAt:desc',
      page: '2',
      pageSize: '20',
      status: 'new,ready',
      q: 'урожайная',
    });
  });

  it('сортировка и размер страницы — не фильтры', () => {
    expect(hasFilters(ordersSearchSchema.parse({ sort: 'amount:desc', pageSize: 50 }))).toBe(false);
    expect(hasFilters(ordersSearchSchema.parse({ restaurantId: 3 }))).toBe(true);
  });
});
