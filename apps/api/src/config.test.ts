import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EXAMPLE_JWT_SECRET, loadConfig } from './config';

// Минимальный набор для production: строгие проверки включены.
const VALID_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://foodster:foodster@localhost:5432/foodster',
  JWT_SECRET: 'x'.repeat(32),
};

// Локальный запуск: так переменные приходят из .env.example.
const DEV_ENV = { ...VALID_ENV, NODE_ENV: 'development', COOKIE_SECURE: 'false' };

describe('loadConfig', () => {
  it('подставляет значения по умолчанию', () => {
    expect(loadConfig(VALID_ENV)).toMatchObject({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: 3000,
      SESSION_TTL_HOURS: 12,
      LOG_LEVEL: 'info',
      COOKIE_SECURE: true,
    });
    expect(loadConfig(VALID_ENV).TRUST_PROXY).toBeUndefined();
  });

  it('приводит PORT из строки к числу', () => {
    expect(loadConfig({ ...VALID_ENV, PORT: '10000' }).PORT).toBe(10000);
  });

  it('без NODE_ENV не запускается: окружение задаётся явно', () => {
    expect(() => loadConfig({ ...VALID_ENV, NODE_ENV: undefined })).toThrow(/NODE_ENV/);
  });

  it('падает с понятной ошибкой без JWT_SECRET', () => {
    expect(() => loadConfig({ DATABASE_URL: VALID_ENV.DATABASE_URL })).toThrow(/JWT_SECRET/);
  });

  it('не принимает короткий JWT_SECRET', () => {
    expect(() => loadConfig({ ...VALID_ENV, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('Secure у cookie включён по умолчанию и выключается только явно и не в production', () => {
    expect(loadConfig({ ...DEV_ENV, COOKIE_SECURE: undefined }).COOKIE_SECURE).toBe(true);
    expect(loadConfig(DEV_ENV).COOKIE_SECURE).toBe(false);
    expect(() => loadConfig({ ...VALID_ENV, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
  });

  it('в production не принимает JWT_SECRET из .env.example, локально — принимает', () => {
    expect(() => loadConfig({ ...VALID_ENV, JWT_SECRET: EXAMPLE_JWT_SECRET })).toThrow(
      /JWT_SECRET/,
    );
    expect(loadConfig({ ...DEV_ENV, JWT_SECRET: EXAMPLE_JWT_SECRET }).NODE_ENV).toBe('development');
  });

  it('TRUST_PROXY: список адресов прокси, пустое значение — ошибка', () => {
    expect(loadConfig({ ...VALID_ENV, TRUST_PROXY: ' 10.0.0.0/8 ' }).TRUST_PROXY).toBe(
      '10.0.0.0/8',
    );
    expect(() => loadConfig({ ...VALID_ENV, TRUST_PROXY: ' ' })).toThrow(/TRUST_PROXY/);
  });

  it('SESSION_TTL_HOURS — не больше недели (таймер закрытия потока SSE)', () => {
    expect(loadConfig({ ...VALID_ENV, SESSION_TTL_HOURS: '168' }).SESSION_TTL_HOURS).toBe(168);
    expect(() => loadConfig({ ...VALID_ENV, SESSION_TTL_HOURS: '169' })).toThrow(
      /SESSION_TTL_HOURS/,
    );
  });

  it('не принимает неизвестный LOG_LEVEL', () => {
    expect(() => loadConfig({ ...VALID_ENV, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('ошибки конфигурации — системные, на английском, даже при включённой русской локали zod', () => {
    // Как в работающем приложении: app.ts включает русскую локаль глобально.
    z.config(z.locales.ru());
    try {
      expect(() => loadConfig({ DATABASE_URL: VALID_ENV.DATABASE_URL })).toThrow(/^[^а-яё]*$/i);
    } finally {
      z.config(z.locales.en());
    }
  });

  it('не принимает невалидный DATABASE_URL', () => {
    expect(() => loadConfig({ ...VALID_ENV, DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/);
  });
});
