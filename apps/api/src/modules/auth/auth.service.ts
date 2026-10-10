import type { LoginBody, Operator } from '@foodster/shared';
import { verifyPassword } from '../../auth/password';
import type { Database } from '../../db/client';
import { findOperatorById, toOperatorDto } from '../operators/operators.repository';

// null — и для неизвестного оператора, и для неверного пароля: ответ не подсказывает,
// что именно не так.
export async function authenticateOperator(
  db: Database,
  credentials: LoginBody,
): Promise<Operator | null> {
  const row = await findOperatorById(db, credentials.operatorId);
  if (!row) return null;
  const valid = await verifyPassword(credentials.password, row.passwordHash);
  return valid ? toOperatorDto(row) : null;
}
