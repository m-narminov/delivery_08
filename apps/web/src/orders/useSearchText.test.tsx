import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSearchText } from './useSearchText';

// Синхронизация поля поиска с адресом страницы. urlQ — поиск из адреса, entryKey — ключ записи
// истории (новый при каждом переходе, при «Назад» — прежний). commit — отправка поиска в адрес.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(initial: { urlQ?: string; entryKey?: string } = {}) {
  const commit = vi.fn<(q: string | undefined) => void>();
  const hook = renderHook(
    ({ urlQ, entryKey }: { urlQ?: string; entryKey?: string }) =>
      useSearchText(urlQ, entryKey, commit),
    { initialProps: { urlQ: initial.urlQ, entryKey: initial.entryKey ?? 'k1' } },
  );
  // act с колбэком без возвращаемого значения синхронный; ожидание времени — асинхронное
  // (advanceTimersByTimeAsync даёт выполниться и промисам).
  const type = (value: string) => {
    act(() => {
      hook.result.current.change(value);
    });
  };
  const wait = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  return { ...hook, commit, type, wait };
}

describe('useSearchText', () => {
  it('буквы видны сразу, в адрес поиск уходит один раз — после паузы 300 мс', async () => {
    const { result, commit, type, wait } = setup();
    type('с');
    type('са');
    type('сад');
    expect(result.current.text).toBe('сад');
    await wait(299);
    expect(commit).not.toHaveBeenCalled();
    await wait(1);
    expect(commit).toHaveBeenCalledExactlyOnceWith('сад');
  });

  it('пробел в конце и повтор того же текста не отправляются заново', async () => {
    const { commit, type, wait, rerender } = setup();
    type('сад');
    await wait(300);
    rerender({ urlQ: 'сад', entryKey: 'k2' });
    type('сад ');
    await wait(300);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('своя отправка дошла до адреса — дописанные за это время буквы не стираются', async () => {
    const { result, commit, type, wait, rerender } = setup();
    type('сад');
    await wait(300);
    // Пока переход шёл, оператор дописал букву.
    type('садо');
    // Адрес обновился на отправленное «сад» — это своя отправка, поле не трогаем.
    rerender({ urlQ: 'сад', entryKey: 'k2' });
    expect(result.current.text).toBe('садо');
    // И дописанное уходит в адрес после своей паузы, а не теряется.
    await wait(300);
    expect(commit).toHaveBeenLastCalledWith('садо');
  });

  it('изменение извне (ссылка, «Назад» на другой поиск, сброс) — текст из адреса', () => {
    const { result, rerender } = setup({ urlQ: 'сад' });
    rerender({ urlQ: 'ленина', entryKey: 'k2' });
    expect(result.current.text).toBe('ленина');
    rerender({ urlQ: undefined, entryKey: 'k3' });
    expect(result.current.text).toBe('');
  });

  it('«Назад» на запись с тем же поиском, пока шла пауза, — набранное отменяется', async () => {
    const { result, commit, type, wait, rerender } = setup({ urlQ: 'а', entryKey: 'k1' });
    type('аб');
    // Переход на другую запись истории (тот же поиск «а»): отложенный текст устарел.
    rerender({ urlQ: 'а', entryKey: 'k0' });
    expect(result.current.text).toBe('а');
    await wait(300);
    expect(commit).not.toHaveBeenCalled();
  });

  it('takePending отдаёт набранное, но ещё не отправленное, и отменяет отложенную отправку', async () => {
    const { result, commit, type, wait } = setup();
    type('  сад ');
    let pending: string | undefined;
    act(() => {
      pending = result.current.takePending();
    });
    expect(pending).toBe('сад');
    await wait(300);
    expect(commit).not.toHaveBeenCalled();
  });

  it('clear стирает поле и отменяет отложенную отправку', async () => {
    const { result, commit, type, wait } = setup({ urlQ: 'сад' });
    type('садовая');
    act(() => {
      result.current.clear();
    });
    expect(result.current.text).toBe('');
    await wait(300);
    expect(commit).not.toHaveBeenCalled();
  });
});
