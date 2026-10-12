import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { createLogger } from '../../src/logger';
import { insertOperator, loginAs, testConfig } from '../app';
import { closedDatabase, createTestDatabase, type TestDatabase } from '../db';

// Логгер, который складывает строки в массив вместо stdout.
function captureLogger(level: string) {
  const lines: Record<string, unknown>[] = [];
  const destination = {
    write: (line: string) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  };
  return { lines, logger: createLogger({ level, destination }) };
}

let testDb: TestDatabase;
let operatorId: number;

beforeAll(async () => {
  testDb = await createTestDatabase();
  operatorId = (await insertOperator(testDb.db)).id;
});

afterAll(async () => {
  await testDb.drop();
});

describe('журнал запросов', () => {
  it('health check не пишет записи о запросах, остальные маршруты — пишут с id запроса', async () => {
    const { lines, logger } = captureLogger('info');
    const app = await buildApp({ config: testConfig(), db: testDb.db, logger });
    try {
      await app.inject({ method: 'GET', url: '/api/health' });
      expect(lines.filter((line) => line.msg === 'incoming request')).toHaveLength(0);

      await app.inject({ method: 'GET', url: '/api/operators' });
      const incoming = lines.filter((line) => line.msg === 'incoming request');
      expect(incoming).toHaveLength(1);
      expect(typeof incoming[0]?.reqId).toBe('string');
    } finally {
      await app.close();
    }
  });

  it('уровень silent глушит и ошибку health check (раньше её пропускал logLevel маршрута)', async () => {
    const { lines, logger } = captureLogger('silent');
    const db = await closedDatabase();
    const app = await buildApp({ config: testConfig(), db, logger });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(503);
      expect(lines).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('при уровне info ошибка health check записывается', async () => {
    const { lines, logger } = captureLogger('info');
    const db = await closedDatabase();
    const app = await buildApp({ config: testConfig(), db, logger });
    try {
      await app.inject({ method: 'GET', url: '/api/health' });
      expect(lines.map((line) => line.msg)).toContain('Database health check failed');
    } finally {
      await app.close();
    }
  });
});

describe('безопасность в логах', () => {
  it('неудачный вход записывается как warn с id оператора и адресами, но без пароля', async () => {
    const { lines, logger } = captureLogger('info');
    const app = await buildApp({ config: testConfig(), db: testDb.db, logger });
    try {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { operatorId: 999_999, password: 'guessed-password' },
        headers: { 'x-forwarded-for': '203.0.113.7' },
      });
      // Прокси не задан: лимит считается по адресу соединения, цепочка — для диагностики.
      expect(lines.find((line) => line.msg === 'Login failed')).toMatchObject({
        level: 40,
        operatorId: 999_999,
        ip: '127.0.0.1',
        socketAddress: '127.0.0.1',
        forwardedFor: '203.0.113.7',
      });
      expect(JSON.stringify(lines)).not.toContain('guessed-password');
    } finally {
      await app.close();
    }
  });

  it('отказ по лимиту входа — warn с адресом; длинный X-Forwarded-For в лог обрезается', async () => {
    const { lines, logger } = captureLogger('info');
    const app = await buildApp({ config: testConfig(), db: testDb.db, logger });
    const forwardedFor = '198.51.100.1, '.repeat(200);
    try {
      for (let i = 0; i < 6; i += 1) {
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { operatorId: 999_999, password: 'wrong' },
          remoteAddress: '203.0.113.20',
          headers: { 'x-forwarded-for': forwardedFor },
        });
      }
      const exceeded = lines.filter((line) => line.msg === 'Login rate limit exceeded');
      expect(exceeded).toHaveLength(1);
      expect(exceeded[0]).toMatchObject({ level: 40, ip: '203.0.113.20' });
      expect(exceeded[0]?.forwardedFor).toBe(`${forwardedFor.slice(0, 256)}…`);
    } finally {
      await app.close();
    }
  });

  it('удачный вход записывается с адресом', async () => {
    const { lines, logger } = captureLogger('info');
    const app = await buildApp({ config: testConfig(), db: testDb.db, logger });
    try {
      await loginAs(app, operatorId);
      expect(lines.find((line) => line.msg === 'Operator logged in')).toMatchObject({
        operatorId,
        ip: expect.any(String) as unknown,
        socketAddress: expect.any(String) as unknown,
      });
    } finally {
      await app.close();
    }
  });

  // inject() подключается с адреса 127.0.0.1 — он и играет роль прокси.
  it.each([
    ['прокси не задан — X-Forwarded-For игнорируется', undefined, '127.0.0.1'],
    ['запрос от доверенного прокси — IP клиента из X-Forwarded-For', '127.0.0.1', '203.0.113.7'],
    ['запрос не от доверенного прокси — заголовок игнорируется', '10.0.0.1', '127.0.0.1'],
  ])('%s', async (_case, trustProxy, expectedIp) => {
    const { lines, logger } = captureLogger('info');
    const config = testConfig({ TRUST_PROXY: trustProxy });
    const app = await buildApp({ config, db: testDb.db, logger });
    try {
      await app.inject({
        method: 'GET',
        url: '/api/operators',
        headers: { 'x-forwarded-for': '203.0.113.7' },
      });
      const incoming = lines.find((line) => line.msg === 'incoming request');
      expect(incoming?.req).toMatchObject({ remoteAddress: expectedIp });
    } finally {
      await app.close();
    }
  });
});
