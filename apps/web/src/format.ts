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

// plural(3, ['заказ', 'заказа', 'заказов']) → 'заказа'. Формы: one, few, many.
export function plural(count: number, [one, few, many]: readonly [string, string, string]): string {
  const form = pluralRules.select(count);
  return form === 'one' ? one : form === 'few' ? few : many;
}
