import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../src/app';
import { createDatabase } from '../../src/db/client';
import { AppError } from '../../src/errors';
import { createTestApp, testConfig, type TestApp } from '../app';
import { databaseUrl, TEMPLATE_DATABASE } from '../db';

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  errors?: { location: string; path: string; message: string }[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let app: TestApp;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ app, close } = await createTestApp());

  // Служебные маршруты только для этого теста: регистрируются до первого запроса (до ready).
  app.get('/api/__test/unexpected-error', () => {
    throw new Error('secret detail: password=hunter2 at db.ts:42');
  });
  app.get('/api/__test/thrown-non-error', () => {
    const notAnError: unknown = 'boom';
    throw notAnError;
  });
  app.get(
    '/api/__test/bad-response',
    { schema: { response: { 200: z.object({ id: z.number().int() }) } } },
    () => ({ id: 1.5 }),
  );
  app.get('/api/__test/app-error-extensions', () => {
    throw new AppError(409, 'TEST_CONFLICT', 'Test conflict', {
      status: 200,
      code: 'HIJACKED',
      type: 'https://evil.example',
      hint: 'kept',
    });
  });
  app.get('/api/__test/client-error-with-headers', () => {
    throw Object.assign(new Error('Too many requests'), {
      statusCode: 429,
      headers: { 'retry-after': '30' },
    });
  });
});

afterAll(async () => {
  await close();
});

describe('формат ошибок (RFC 9457 problem+json)', () => {
  it('неизвестный маршрут → 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/unknown' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json<ProblemBody>()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Route GET /api/unknown not found',
      instance: '/api/unknown',
      code: 'NOT_FOUND',
    });
  });

  it('невалидное тело → 400 с ошибками по полям', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { operatorId: 'abc', password: '' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<ProblemBody>();
    expect(body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', title: 'Bad Request' });
    expect(body.errors?.length).toBeGreaterThan(0);
    expect(body.errors?.every(({ location }) => location === 'body')).toBe(true);
  });

  it('тексты для пользователя — по-русски: detail и сообщения по полям', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { operatorId: 'abc', password: '' },
    });
    const body = response.json<ProblemBody>();
    expect(body.detail).toBe('Проверьте данные запроса');
    // Две ошибки: operatorId не число и пустой пароль. Без проверки длины every на пустом
    // массиве вернул бы true и тест прошёл бы впустую.
    expect(body.errors).toHaveLength(2);
    expect(body.errors?.every(({ message }) => /[а-яё]/i.test(message))).toBe(true);
  });

  it('битый JSON → 400 со стабильным кодом, без внутренних кодов Fastify', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"operatorId": 1,',
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json<ProblemBody>()).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
  });

  it('неожиданная ошибка → 500 без подробностей', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/__test/unexpected-error' });
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json<ProblemBody>()).toMatchObject({
      title: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
      detail: 'Internal server error',
    });
    expect(response.body).not.toContain('hunter2');
  });

  it('брошено не Error (строка) → всё равно 500 problem+json', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/__test/thrown-non-error' });
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json<ProblemBody>().code).toBe('INTERNAL_ERROR');
  });

  it('ответ не прошёл схему → 500 без подробностей', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/__test/bad-response' });
    expect(response.statusCode).toBe(500);
    expect(response.json<ProblemBody>().code).toBe('INTERNAL_ERROR');
  });

  it('расширения не перезаписывают стандартные поля', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/__test/app-error-extensions' });
    expect(response.statusCode).toBe(409);
    expect(response.json<unknown>()).toMatchObject({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'TEST_CONFLICT',
      hint: 'kept',
    });
  });

  it('статус вне частых: стандартный title и сохранённые заголовки ошибки', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/__test/client-error-with-headers',
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
    expect(response.json<ProblemBody>()).toMatchObject({
      title: 'Too Many Requests',
      code: 'TOO_MANY_REQUESTS',
    });
  });
});

describe('id запроса', () => {
  it('корректный входящий X-Request-Id возвращается в ответе', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'render-abc_123' },
    });
    expect(response.headers['x-request-id']).toBe('render-abc_123');
  });

  it.each([
    ['пробелы и спецсимволы', 'bad id!'],
    ['слишком длинный', 'a'.repeat(65)],
  ])('%s → заменяется своим UUID', async (_case, incoming) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': incoming },
    });
    expect(response.headers['x-request-id']).toMatch(UUID_PATTERN);
  });
});

describe('GET /api/health', () => {
  it('БД доступна → 200 ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toEqual({ status: 'ok' });
  });

  it('БД недоступна → 503 unavailable', async () => {
    // Пул закрыт заранее: любой запрос к БД падает, как при недоступной базе.
    const { db, pool } = createDatabase(databaseUrl(TEMPLATE_DATABASE));
    await pool.end();
    const brokenApp = await buildApp({ config: testConfig(), db });
    try {
      const response = await brokenApp.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(503);
      expect(response.json<unknown>()).toEqual({ status: 'unavailable' });
    } finally {
      await brokenApp.close();
    }
  });
});

describe('GET /api/docs', () => {
  it('отдаёт OpenAPI-спецификацию с нашими маршрутами', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(response.statusCode).toBe(200);
    const spec = response.json<{ paths: Record<string, unknown> }>();
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/api/health', '/api/operators', '/api/auth/login', '/api/auth/me']),
    );
  });
});
