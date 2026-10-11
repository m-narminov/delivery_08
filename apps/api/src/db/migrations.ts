import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';

// Путь от файла, в котором окажется этот код: src/db/migrations.ts при запуске через tsx
// и dist/scripts/migrate.js после сборки (esbuild складывает модуль в бандл скрипта). Оба на
// два уровня ниже apps/api — поэтому одинаково ведут в apps/api/drizzle. Если импортировать
// runMigrations в файл другой глубины (например, dist/server.js), путь придётся поменять.
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

// Применяет миграции, которых ещё нет в таблице drizzle.__drizzle_migrations.
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
