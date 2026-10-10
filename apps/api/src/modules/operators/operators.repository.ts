import type { Operator, OperatorOption } from '@foodster/shared';
import { asc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { operators } from '../../db/schema';

export type OperatorRow = typeof operators.$inferSelect;

export async function findOperatorById(db: Database, id: number): Promise<OperatorRow | undefined> {
  const [row] = await db.select().from(operators).where(eq(operators.id, id)).limit(1);
  return row;
}

export async function listOperatorOptions(db: Database): Promise<OperatorOption[]> {
  return db
    .select({ id: operators.id, name: operators.name })
    .from(operators)
    .orderBy(asc(operators.name));
}

// Строка БД → DTO для ответа: хеш пароля наружу не уходит.
export function toOperatorDto(row: OperatorRow): Operator {
  return { id: row.id, name: row.name, email: row.email };
}
