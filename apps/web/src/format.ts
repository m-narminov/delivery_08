// Форматирование для оператора: русская локаль, часовой пояс браузера.

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' });
const timeOnly = new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' });
const pluralRules = new Intl.PluralRules('ru-RU');

// Сумма хранится в копейках (целое число) — в рубли только при показе.
export function formatMoney(amountMinor: number): string {
  return money.format(amountMinor / 100);
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

// Дата и время по отдельности — когда их показывают в две строки (11.10.2026 и 13:14).
export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeOnly.format(new Date(iso));
}

// 10 цифр российского номера без кода страны или undefined, если номер не похож на российский.
// В базе — E.164 (+79281824909), но понимаем и другие записи тех же цифр:
// - с «+» — только +7 и 10 цифр (у +81… восьмёрка — код Японии, а не российская «восьмёрка»);
// - без «+» — 11 цифр с 7 или 8 в начале или 10 цифр (считаем, что без кода страны: так пишут
//   российские номера, хотя 10 цифр бывают и у других стран — их тоже примем за российские).
function russianNationalNumber(phone: string): string | undefined {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    return digits.length === 11 && digits.startsWith('7') ? digits.slice(1) : undefined;
  }
  if (digits.length === 10) return digits;
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return digits.slice(1);
  }
  return undefined;
}

// Для показа: +7 XXX XXX XX XX. Номер, не похожий на российский, — как есть.
export function formatPhone(phone: string): string {
  const national = russianNationalNumber(phone);
  if (national === undefined) return phone;
  return national.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/, '+7 $1 $2 $3 $4');
}

// Для копирования: E.164 без пробелов (+79281824909) — такой номер понимают звонилки,
// мессенджеры и поиск. Номер, не похожий на российский, — как есть.
export function phoneE164(phone: string): string {
  const national = russianNationalNumber(phone);
  return national === undefined ? phone : `+7${national}`;
}

// plural(3, ['заказ', 'заказа', 'заказов']) → 'заказа'. Формы: one, few, many.
export function plural(count: number, [one, few, many]: readonly [string, string, string]): string {
  const form = pluralRules.select(count);
  return form === 'one' ? one : form === 'few' ? few : many;
}
