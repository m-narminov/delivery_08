import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { createDatabase } from '../../src/db/client';
import { createLogger } from '../../src/logger';
import { testConfig } from '../app';
import { createTestDatabase, databaseUrl, TEMPLATE_DATABASE, type TestDatabase } from '../db';

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

beforeAll(async () => {
  testDb = await createTestDatabase();
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
    const { db, pool } = createDatabase(databaseUrl(TEMPLATE_DATABASE));
    await pool.end();
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
    const { db, pool } = createDatabase(databaseUrl(TEMPLATE_DATABASE));
    await pool.end();
    const app = await buildApp({ config: testConfig(), db, logger });
    try {
      await app.inject({ method: 'GET', url: '/api/health' });
      expect(lines.map((line) => line.msg)).toContain('Database health check failed');
    } finally {
      await app.close();
    }
  });
});
