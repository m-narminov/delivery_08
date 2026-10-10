import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// Адрес тестовой БД — тот же порядок, что у остальных npm-скриптов: переменная окружения
// (например, в CI), затем корневой .env, затем .env.example. Берём только эту переменную:
// LOG_LEVEL и прочее из .env не должны менять поведение тестов.
function readEnvFile(name: string): NodeJS.Dict<string> {
  const path = new URL(`../../${name}`, import.meta.url);
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  readEnvFile('.env').TEST_DATABASE_URL ??
  readEnvFile('.env.example').TEST_DATABASE_URL;
// Присваивать undefined нельзя: process.env превращает его в строку "undefined".
if (testDatabaseUrl !== undefined) process.env.TEST_DATABASE_URL = testDatabaseUrl;

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
