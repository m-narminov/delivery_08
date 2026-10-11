// Форматирование для оператора: русская локаль, часовой пояс браузера.

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const pluralRules = new Intl.PluralRules('ru-RU');

// Сумма хранится в копейках (целое число) — в рубли только при показе.
export function formatMoney(amountMinor: number): string {
  return money.format(amountMinor / 100);
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

// Российский номер для показа: +7 XXX XXX XX XX. В базе — E.164 (+79281824909), но понимаем и
// другие записи тех же цифр:
// - с «+» — только +7 и 10 цифр (у +81… восьмёрка — код Японии, а не российская «восьмёрка»);
// - без «+» — 11 цифр с 7 или 8 в начале или 10 цифр (считаем, что без кода страны: так пишут
//   российские номера, хотя 10 цифр бывают и у других стран — их тоже покажем как российские).
// Остальное показываем как есть.
export function formatPhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  let national: string | undefined;
  if (trimmed.startsWith('+')) {
    national = digits.length === 11 && digits.startsWith('7') ? digits.slice(1) : undefined;
  } else if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    national = digits.slice(1);
  }
  if (national === undefined) return phone;
  return national.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/, '+7 $1 $2 $3 $4');
}

// plural(3, ['заказ', 'заказа', 'заказов']) → 'заказа'. Формы: one, few, many.
export function plural(count: number, [one, few, many]: readonly [string, string, string]): string {
  const form = pluralRules.select(count);
  return form === 'one' ? one : form === 'few' ? few : many;
}
