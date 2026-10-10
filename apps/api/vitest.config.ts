import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Переменные из корневого .env. Значения из окружения (например, в CI) имеют приоритет.
const rootEnv = loadEnv('test', fileURLToPath(new URL('../..', import.meta.url)), '');
process.env.TEST_DATABASE_URL ??= rootEnv.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Логи в тестах выключены. Посмотреть: LOG_LEVEL=debug npm test
    env: { LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent' },
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
