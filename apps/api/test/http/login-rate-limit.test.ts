import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, insertOperator, problemBody, TEST_PASSWORD, type TestApp } from '../app';

// Вход ограничен: 5 попыток в минуту с одного IP. Каждый тест — со своего адреса, чтобы
// счётчики не пересекались.
const MAX_ATTEMPTS = 5;

let app: TestApp;
let trustingApp: TestApp;
let operatorId: number;
const closers: (() => Promise<void>)[] = [];

beforeAll(async () => {
  const plain = await createTestApp();
  // За прокси: X-Forwarded-For принимается только от 127.0.0.1 (адрес inject по умолчанию).
  const behindProxy = await createTestApp({ config: { TRUST_PROXY: '127.0.0.1' } });
  closers.push(plain.close, behindProxy.close);
  app = plain.app;
  trustingApp = behindProxy.app;
  // Пароль в тестах неверный (кроме проверок «вход снова работает»), так что во втором
  // приложении оператор не нужен: 401 он получит и так.
  operatorId = (await insertOperator(plain.db)).id;
});

afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
});

afterEach(() => {
  vi.useRealTimers();
});

function attempt(
  target: TestApp,
  options: { ip?: string; forwardedFor?: string; password?: string } = {},
) {
  return target.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { operatorId, password: options.password ?? 'wrong-password' },
    ...(options.ip && { remoteAddress: options.ip }),
    ...(options.forwardedFor && { headers: { 'x-forwarded-for': options.forwardedFor } }),
  });
}

async function exhaust(target: TestApp, options: { ip?: string; forwardedFor?: string }) {
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    expect((await attempt(target, options)).statusCode).toBe(401);
  }
}

describe('POST /api/auth/login — ограничение частоты', () => {
  it('шестая попытка за минуту — 429 problem+json с Retry-After, даже с верным паролем', async () => {
    await exhaust(app, { ip: '203.0.113.1' });

    const response = await attempt(app, { ip: '203.0.113.1', password: TEST_PASSWORD });
    expect(response.statusCode).toBe(429);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(problemBody(response)).toMatchObject({ status: 429, code: 'LOGIN_RATE_LIMITED' });
    const retryAfter = Number(response.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    // Время в тексте — то же, что в Retry-After (секунды, не миллисекунды).
    expect(problemBody(response).detail).toBe(
      `Слишком много попыток входа. Повторите через ${retryAfter} с`,
    );
    expect(response.headers['x-ratelimit-limit']).toBe(String(MAX_ATTEMPTS));
    // Сессию при отказе не выдаём.
    expect(response.cookies).toEqual([]);
  });

  it('другие маршруты не ограничены', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/operators' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('лимит у каждого адреса свой', async () => {
    await exhaust(app, { ip: '203.0.113.2' });
    expect((await attempt(app, { ip: '203.0.113.2' })).statusCode).toBe(429);
    expect((await attempt(app, { ip: '203.0.113.3', password: TEST_PASSWORD })).statusCode).toBe(
      200,
    );
  });

  it('через минуту счётчик сбрасывается', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await exhaust(app, { ip: '203.0.113.4' });
    expect((await attempt(app, { ip: '203.0.113.4' })).statusCode).toBe(429);

    vi.setSystemTime(Date.now() + 60_000);
    expect((await attempt(app, { ip: '203.0.113.4', password: TEST_PASSWORD })).statusCode).toBe(
      200,
    );
  });

  it('без TRUST_PROXY подделанный X-Forwarded-For не обходит лимит', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const response = await attempt(app, { ip: '203.0.113.5', forwardedFor: `198.51.100.${i}` });
      expect(response.statusCode).toBe(401);
    }
    const response = await attempt(app, { ip: '203.0.113.5', forwardedFor: '198.51.100.99' });
    expect(response.statusCode).toBe(429);
  });

  it('с TRUST_PROXY лимит считается по IP клиента из X-Forwarded-For, а не по адресу прокси', async () => {
    // Все запросы приходят от «прокси» 127.0.0.1, клиенты разные.
    await exhaust(trustingApp, { forwardedFor: '198.51.100.10' });
    expect((await attempt(trustingApp, { forwardedFor: '198.51.100.10' })).statusCode).toBe(429);
    expect((await attempt(trustingApp, { forwardedFor: '198.51.100.11' })).statusCode).toBe(401);
  });
});
