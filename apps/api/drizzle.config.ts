import { defineConfig } from 'drizzle-kit';

// Нужен только для генерации миграций (drizzle-kit generate): подключение к БД не требуется.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
