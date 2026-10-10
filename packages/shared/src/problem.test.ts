import { describe, expect, it } from 'vitest';
import { ERROR_CODES, problemSchema, versionConflictProblemSchema } from './problem';

const base = {
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  detail: 'Такой переход статуса недоступен',
  instance: '/api/orders/1/transitions',
  code: 'TRANSITION_NOT_ALLOWED',
};

describe('problemSchema', () => {
  it('сохраняет дополнительные поля ошибки — при сериализации они не теряются', () => {
    const body = { ...base, code: 'COURIER_LIMIT_REACHED', activeDeliveries: 3, limit: 3 };
    expect(problemSchema.parse(body)).toEqual(body);
  });

  it('без обязательного поля — не ошибка API', () => {
    expect(problemSchema.safeParse({ ...base, code: undefined }).success).toBe(false);
  });
});

describe('versionConflictProblemSchema', () => {
  it('требует актуальный заказ и последнее изменение (могут быть null)', () => {
    const conflict = { ...base, status: 412, code: 'VERSION_CONFLICT' };
    expect(versionConflictProblemSchema.safeParse(conflict).success).toBe(false);
    expect(
      versionConflictProblemSchema.safeParse({ ...conflict, current: null, lastChange: null })
        .success,
    ).toBe(true);
  });
});

describe('ERROR_CODES', () => {
  it('коды не повторяются', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
