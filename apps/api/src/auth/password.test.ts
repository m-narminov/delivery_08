import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('принимает верный пароль', async () => {
    const hash = await hashPassword('secret');
    expect(await verifyPassword('secret', hash)).toBe(true);
  });

  it('отклоняет неверный пароль', async () => {
    const hash = await hashPassword('secret');
    expect(await verifyPassword('Secret', hash)).toBe(false);
  });

  it('один и тот же пароль даёт разные хеши (случайная соль)', async () => {
    expect(await hashPassword('secret')).not.toBe(await hashPassword('secret'));
  });

  it.each(['', 'plain-text', 'bcrypt$a$b', 'scrypt$$'])(
    'отклоняет хеш в чужом формате: %s',
    async (stored) => {
      expect(await verifyPassword('secret', stored)).toBe(false);
    },
  );
});
