import { useDebouncedCallback } from '@mantine/hooks';
import { useState } from 'react';

// Пауза после ввода, прежде чем искать: не слать запрос на каждую букву.
const SEARCH_DEBOUNCE_MS = 300;

// Текст поля поиска и его связь с адресом. У поля своё состояние: буквы появляются сразу,
// а в адрес (и в запрос) поиск уходит после паузы.
//
// urlQ — поиск из *ожидающего* адреса (куда роутер уже переходит), а не из применённого
// маршрута: тогда своя отправка видна сразу, без окна, в котором её можно принять за чужую.
// Синхронизация — только при переходе: поиск в адресе изменился или сменилась запись (ниже):
// - на последнее отправленное нами значение — это наша отправка, поле не трогаем (пользователь
//   мог уже допечатать буквы);
// - на другое значение — изменение извне («Назад», ссылка, сброс фильтров): текст в поле.
//
// entryKey — ключ текущей записи истории (новый при каждом переходе, при «Назад» — прежний):
// - запись сменилась, а поиск в адресе тот же («Назад» на запись с тем же поиском, смена
//   фильтра) — это тоже переход, текст в поле приводим к адресу;
// - запись сменилась во время паузы — отложенная отправка устарела: иначе она ушла бы уже
//   на другую запись истории. Свою смену фильтра или страницы OrdersPage делает через
//   takePending(): набранный, но не отправленный текст уходит вместе с ней.
export function useSearchText(
  urlQ: string | undefined,
  entryKey: string | undefined,
  commit: (q: string | undefined) => void,
) {
  const [text, setText] = useState(urlQ ?? '');
  // Последнее отправленное (или пришедшее извне) значение: повтор того же не отправляем.
  const [sent, setSent] = useState(urlQ);
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  const [prevKey, setPrevKey] = useState(entryKey);
  if (urlQ !== prevUrlQ || entryKey !== prevKey) {
    setPrevUrlQ(urlQ);
    setPrevKey(entryKey);
    // Наша отправка всегда меняет поиск (повтор отсекается), так что «поиск сменился на
    // отправленное» — своя, а любое другое изменение адреса или записи — извне. Текст,
    // совпадающий с адресом с точностью до пробелов по краям, не трогаем.
    const own = urlQ !== prevUrlQ && urlQ === sent;
    if (!own && (text.trim() || undefined) !== urlQ) setText(urlQ ?? '');
    if (!own) setSent(urlQ);
  }
  // На какой записи истории набран текст, ожидающий отправки.
  const [typedOn, setTypedOn] = useState(entryKey);

  // useDebouncedCallback зовёт свежую версию колбэка: text, sent, entryKey и typedOn —
  // последнего рендера.
  const send = useDebouncedCallback((value: string) => {
    // Поле переписали извне или сменилась запись истории — отложенный текст устарел.
    if (value !== text || entryKey !== typedOn) return;
    const q = value.trim() || undefined;
    // Пробел в конце или повтор того же текста — искать заново незачем.
    if (q === sent) return;
    setSent(q);
    commit(q);
  }, SEARCH_DEBOUNCE_MS);

  return {
    text,
    change(value: string) {
      setText(value);
      setTypedOn(entryKey);
      send(value);
    },
    // Перед своей сменой фильтра или страницы: отменяет отложенную отправку и возвращает
    // поиск, который должен уйти вместе с этим переходом (набранное не теряется).
    takePending(): string | undefined {
      send.cancel();
      const q = text.trim() || undefined;
      setSent(q);
      return q;
    },
    // Перед сбросом фильтров и очисткой поиска: отложенная отправка вернула бы старый текст,
    // а ещё не отправленный текст иначе остался бы в поле при сброшенном списке.
    clear() {
      send.cancel();
      setText('');
    },
  };
}

export type SearchText = ReturnType<typeof useSearchText>;
