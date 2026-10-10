import { describe, expect, it } from 'vitest';
import {
  cancelBodySchema,
  courierBodySchema,
  idParamSchema,
  orderListQuerySchema,
  transitionBodySchema,
} from './schemas';

describe('orderListQuerySchema', () => {
  it('подставляет значения по умолчанию', () => {
    expect(orderListQuerySchema.parse({})).toEqual({
      sort: 'createdAt:desc',
      page: 1,
      pageSize: 20,
    });
  });

  it('разбирает список статусов через запятую', () => {
    expect(orderListQuerySchema.parse({ status: 'new, ready' }).status).toEqual(['new', 'ready']);
  });

  it('пустой status — без фильтра', () => {
    expect(orderListQuerySchema.parse({ status: '' }).status).toBeUndefined();
  });

  it('отклоняет неизвестный статус', () => {
    expect(orderListQuerySchema.safeParse({ status: 'new,unknown' }).success).toBe(false);
  });

  it('приводит строки из URL к числам', () => {
    const query = orderListQuerySchema.parse({ page: '2', pageSize: '50', restaurantId: '5' });
    expect(query).toMatchObject({ page: 2, pageSize: 50, restaurantId: 5 });
  });

  it.each([
    ['page', '0'],
    ['page', 'abc'],
    ['pageSize', '101'],
    ['restaurantId', '-1'],
    ['sort', 'name:asc'],
  ])('отклоняет %s=%s', (key, value) => {
    expect(orderListQuerySchema.safeParse({ [key]: value }).success).toBe(false);
  });

  it('обрезает пробелы в поиске, пустой поиск — без фильтра', () => {
    expect(orderListQuerySchema.parse({ q: '  ленина 5 ' }).q).toBe('ленина 5');
    expect(orderListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('ограничивает длину поиска', () => {
    expect(orderListQuerySchema.safeParse({ q: 'а'.repeat(201) }).success).toBe(false);
  });

  it('отклоняет символ NUL в поиске', () => {
    expect(orderListQuerySchema.safeParse({ q: 'ленина\u0000' }).success).toBe(false);
  });
});

describe('cancelBodySchema', () => {
  it('без причины — null', () => {
    expect(cancelBodySchema.parse({})).toEqual({ reason: null });
  });

  it('причина из пробелов — null', () => {
    expect(cancelBodySchema.parse({ reason: '   ' })).toEqual({ reason: null });
  });

  it('обрезает пробелы вокруг причины', () => {
    expect(cancelBodySchema.parse({ reason: ' клиент передумал ' })).toEqual({
      reason: 'клиент передумал',
    });
  });

  it('допускает ровно 2000 символов и отклоняет 2001', () => {
    expect(cancelBodySchema.safeParse({ reason: 'я'.repeat(2000) }).success).toBe(true);
    expect(cancelBodySchema.safeParse({ reason: 'я'.repeat(2001) }).success).toBe(false);
  });

  it('отклоняет символ NUL в причине', () => {
    expect(cancelBodySchema.safeParse({ reason: 'клиент\u0000передумал' }).success).toBe(false);
  });
});

describe('courierBodySchema', () => {
  it('null — снять курьера', () => {
    expect(courierBodySchema.parse({ courierId: null })).toEqual({ courierId: null });
  });

  it('courierId обязателен: снять курьера можно только явным null', () => {
    expect(courierBodySchema.safeParse({}).success).toBe(false);
  });

  it('в JSON-теле id должен быть числом, а не строкой', () => {
    expect(courierBodySchema.safeParse({ courierId: '5' }).success).toBe(false);
  });
});

describe('idParamSchema', () => {
  it.each(['0', '-1', '1.5', 'abc'])('отклоняет %s', (value) => {
    expect(idParamSchema.safeParse(value).success).toBe(false);
  });

  it('приводит строку к числу', () => {
    expect(idParamSchema.parse('42')).toBe(42);
  });
});

describe('transitionBodySchema', () => {
  it('принимает статус цепочки', () => {
    expect(transitionBodySchema.parse({ to: 'ready' })).toEqual({ to: 'ready' });
  });

  it('не принимает cancelled — для отмены отдельный эндпоинт', () => {
    expect(transitionBodySchema.safeParse({ to: 'cancelled' }).success).toBe(false);
  });
});
