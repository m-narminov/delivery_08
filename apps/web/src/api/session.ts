import {
  operatorOptionSchema,
  sessionSchema,
  type LoginBody,
  type Session,
} from '@foodster/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from './client';
import { isUnauthorized } from './errors';

// Текущая сессия: null — оператор не вошёл (API ответил 401). Это не ошибка, а состояние.
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async ({ signal }): Promise<Session | null> => {
    try {
      return (await apiRequest('/api/auth/me', sessionSchema, { signal })).data;
    } catch (error) {
      if (isUnauthorized(error)) return null;
      throw error;
    }
  },
  staleTime: Infinity,
});

// Операторы для экрана входа (публичный маршрут).
export const operatorsQuery = queryOptions({
  queryKey: ['operators'],
  queryFn: async ({ signal }) =>
    (await apiRequest('/api/operators', z.array(operatorOptionSchema), { signal })).data,
});

// Ключ мутации входа: её 401 — неверный пароль, обработчик истёкшей сессии его пропускает.
export const LOGIN_MUTATION_KEY = ['login'] as const;

export async function login(body: LoginBody): Promise<Session> {
  return (await apiRequest('/api/auth/login', sessionSchema, { method: 'POST', body })).data;
}

export async function logout(): Promise<void> {
  await apiRequest('/api/auth/logout', z.null(), { method: 'POST' });
}
