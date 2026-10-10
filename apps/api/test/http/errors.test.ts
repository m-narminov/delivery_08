import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../app';

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  errors?: { location: string; path: string; message: string }[];
}

let app: TestApp;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ app, close } = await createTestApp());
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

  it('битый JSON → 400, а не 500', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"operatorId": 1,',
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json<ProblemBody>().status).toBe(400);
  });
});

describe('GET /api/health', () => {
  it('БД доступна → 200 ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toEqual({ status: 'ok' });
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
