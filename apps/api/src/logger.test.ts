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

  it('не пишет сообщения ниже заданного уровня', () => {
    const { lines, logger } = captureLogs();
    logger.debug('details');
    expect(lines).toHaveLength(0);
  });
});
