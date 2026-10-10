import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const destination = {
    write: (line: string) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  };
  return { lines, logger: createLogger({ level: 'info', destination }) };
}

describe('logger', () => {
  it('пишет структурированный JSON с уровнем, временем и именем сервиса', () => {
    const { lines, logger } = captureLogs();
    logger.info({ orderId: 42 }, 'Order loaded');
    expect(lines[0]).toMatchObject({
      level: 30,
      name: 'foodster-api',
      orderId: 42,
      msg: 'Order loaded',
    });
    expect(typeof lines[0]?.time).toBe('string');
  });

  it('скрывает пароли и cookie', () => {
    const { lines, logger } = captureLogs();
    logger.info({
      password: 'secret',
      operator: { passwordHash: 'scrypt$...' },
      req: { headers: { cookie: 'session=abc', authorization: 'Bearer abc' } },
    });
    const line = JSON.stringify(lines[0]);
    expect(line).not.toContain('secret');
    expect(line).not.toContain('scrypt$');
    expect(line).not.toContain('session=abc');
    expect(line).not.toContain('Bearer abc');
    expect(line).toContain('[redacted]');
  });

  it('у ошибки запроса Drizzle пишет SQL и причину, но не значения параметров', () => {
    const { lines, logger } = captureLogs();
    const queryError = new DrizzleQueryError(
      'insert into "operators" ("email", "password_hash") values ($1, $2)',
      ['anna@example.com', 'scrypt$top-secret-hash'],
      new Error('duplicate key value violates unique constraint'),
    );
    logger.error({ err: queryError }, 'Seed failed');
    // Та же ошибка как причина другой ошибки.
    logger.error({ err: new Error('Seed failed', { cause: queryError }) }, 'Wrapped');

    for (const line of lines) {
      const text = JSON.stringify(line);
      expect(text).not.toContain('top-secret-hash');
      expect(text).not.toContain('anna@example.com');
      expect(text).toContain('insert into');
      expect(text).toContain('duplicate key value');
    }
    expect(lines).toHaveLength(2);
  });

  it('не пишет сообщения ниже заданного уровня', () => {
    const { lines, logger } = captureLogs();
    logger.debug('details');
    expect(lines).toHaveLength(0);
  });
});
