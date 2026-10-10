import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// Адреса тестовых Postgres и Valkey — тот же порядок, что у остальных npm-скриптов: переменная
// окружения (например, в CI), затем корневой .env, затем .env.example. Берём только эти
// переменные: LOG_LEVEL и прочее из .env не должны менять поведение тестов.
function readEnvFile(name: string): NodeJS.Dict<string> {
  const path = new URL(`../../${name}`, import.meta.url);
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}
const envFiles = [readEnvFile('.env'), readEnvFile('.env.example')];
for (const name of ['TEST_DATABASE_URL', 'TEST_REDIS_URL']) {
  const value = process.env[name] ?? envFiles.map((file) => file[name]).find(Boolean);
  // Присваивать undefined нельзя: process.env превращает его в строку "undefined".
  if (value !== undefined) process.env[name] = value;
}

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
