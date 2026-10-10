import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const VALID_ENV = {
  DATABASE_URL: 'postgres://foodster:foodster@localhost:5432/foodster',
  JWT_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('подставляет значения по умолчанию', () => {
    expect(loadConfig(VALID_ENV)).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      SESSION_TTL_HOURS: 12,
    });
  });

  it('приводит PORT из строки к числу', () => {
    expect(loadConfig({ ...VALID_ENV, PORT: '10000' }).PORT).toBe(10000);
  });

  it('падает с понятной ошибкой без JWT_SECRET', () => {
    expect(() => loadConfig({ DATABASE_URL: VALID_ENV.DATABASE_URL })).toThrow(/JWT_SECRET/);
  });

  it('не принимает короткий JWT_SECRET', () => {
    expect(() => loadConfig({ ...VALID_ENV, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('не принимает невалидный DATABASE_URL', () => {
    expect(() => loadConfig({ ...VALID_ENV, DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/);
  });
});
