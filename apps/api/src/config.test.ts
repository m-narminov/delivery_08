import { describe, expect, it } from 'vitest';
import { EXAMPLE_JWT_SECRET, loadConfig } from './config';

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
      LOG_LEVEL: 'info',
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

  it('Secure у cookie включён по умолчанию и выключается только явно', () => {
    expect(loadConfig(VALID_ENV).COOKIE_SECURE).toBe(true);
    expect(loadConfig({ ...VALID_ENV, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });

  it('в production не принимает JWT_SECRET из .env.example', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, NODE_ENV: 'production', JWT_SECRET: EXAMPLE_JWT_SECRET }),
    ).toThrow(/JWT_SECRET/);
    expect(loadConfig({ ...VALID_ENV, JWT_SECRET: EXAMPLE_JWT_SECRET }).NODE_ENV).toBe(
      'development',
    );
  });

  it('не принимает неизвестный LOG_LEVEL', () => {
    expect(() => loadConfig({ ...VALID_ENV, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('не принимает невалидный DATABASE_URL', () => {
    expect(() => loadConfig({ ...VALID_ENV, DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/);
  });
});
