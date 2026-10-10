import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/db/client';
import { operators } from '../../src/db/schema';
import { SESSION_COOKIE, sessionCookieOptions } from '../../src/http/session';
import {
  createTestApp,
  insertOperator,
  loginAs,
  TEST_PASSWORD,
  testConfig,
  type TestApp,
} from '../app';

interface ProblemBody {
  status: number;
  code: string;
  detail: string;
}

let app: TestApp;
let db: Database;
let close: () => Promise<void>;
let operator: Awaited<ReturnType<typeof insertOperator>>;

beforeAll(async () => {
  const testApp = await createTestApp();
  app = testApp.app;
  db = testApp.db;
  close = testApp.close;
  operator = await insertOperator(testApp.db, { name: 'Анна Смирнова' });
});

afterAll(async () => {
  await close();
});

describe('GET /api/operators', () => {
  it('отдаёт список для экрана входа без email и хеша пароля', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/operators' });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toEqual([{ id: operator.id, name: 'Анна Смирнова' }]);
  });
});

describe('POST /api/auth/login', () => {
  it('ставит httpOnly-cookie сессии и возвращает оператора', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { operatorId: operator.id, password: TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toEqual({
      operator: { id: operator.id, name: operator.name, email: operator.email },
    });
    const cookie = response.cookies.find(({ name }) => name === SESSION_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  });

  it.each([
    ['неверный пароль', () => ({ operatorId: operator.id, password: 'wrong' })],
    ['несуществующий оператор', () => ({ operatorId: 999_999, password: TEST_PASSWORD })],
  ])('%s → 401 с одинаковым сообщением', async (_case, payload) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: payload(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json<ProblemBody>()).toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Неверный оператор или пароль',
    });
    expect(response.cookies).toHaveLength(0);
  });
});

describe('GET /api/auth/me', () => {
  it('без cookie — 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json<ProblemBody>().code).toBe('UNAUTHORIZED');
  });

  it('с cookie после входа — текущий оператор', async () => {
    const session = await loginAs(app, operator.id);
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toEqual({
      operator: { id: operator.id, name: operator.name, email: operator.email },
    });
  });

  it('с подделанным токеном — 401', async () => {
    const session = await loginAs(app, operator.id);
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: `${session}tampered` },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('сессия: граничные случаи', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('токен в заголовке Authorization: Bearer не принимается — только cookie', async () => {
    const session = await loginAs(app, operator.id);
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${session}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('истёкшая сессия — 401', async () => {
    const session = await loginAs(app, operator.id);
    // Подменяем только Date: fast-jwt берёт текущее время из Date.now().
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(response.statusCode).toBe(401);
  });

  it('удалённый оператор с действующим токеном — 401', async () => {
    const removed = await insertOperator(db, { name: 'Удаляемый оператор' });
    const session = await loginAs(app, removed.id);
    await db.delete(operators).where(eq(operators.id, removed.id));
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(response.statusCode).toBe(401);
  });

  it('флаг Secure у cookie управляется COOKIE_SECURE', () => {
    expect(sessionCookieOptions(testConfig({ COOKIE_SECURE: true })).secure).toBe(true);
    expect(sessionCookieOptions(testConfig({ COOKIE_SECURE: false })).secure).toBe(false);
  });
});

describe('POST /api/auth/logout', () => {
  it('стирает cookie сессии', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(response.statusCode).toBe(204);
    const cookie = response.cookies.find(({ name }) => name === SESSION_COOKIE);
    expect(cookie?.value).toBe('');
    expect(cookie?.expires?.getTime()).toBeLessThan(Date.now());
  });
});
