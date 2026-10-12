// ETag заказа строится из его версии: меняется при каждом изменении заказа. Сервер отдаёт
// сильный ("v3"); в If-Match он может вернуться ослабленным прокси (W/"v3") — см. ниже.
export function versionEtag(version: number): string {
  return `"v${version}"`;
}

// If-None-Match: список ETag через запятую или «*». Сравнение слабое (RFC 9110, 13.1.2):
// W/"v3" совпадает с "v3".
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((candidate) => {
    const tag = candidate.trim();
    return tag === '*' || tag === etag || tag === `W/${etag}`;
  });
}

// Условие из заголовка If-Match: «*» (любая текущая версия) или список ETag.
type IfMatchCondition = { kind: 'any' } | { kind: 'tags'; tags: string[] };

// undefined — заголовка нет (→ 428).
export function parseIfMatch(header: string | undefined): IfMatchCondition | undefined {
  if (header === undefined || header.trim() === '') return undefined;
  if (header.trim() === '*') return { kind: 'any' };
  return { kind: 'tags', tags: header.split(',').map((tag) => tag.trim()) };
}

// Сравнение по версии: W/ перед ETag не учитывается — отступление от строгого сравнения
// RFC 9110 (8.8.3.2), где слабый ETag в If-Match не совпадает ни с чем. Причина — прокси перед
// API: на Render ответ сжимается прокси (Cache-Control: no-transform не соблюдается), и клиенту
// без сжатия приходит распакованный ответ с ослабленным W/"v10" (замер на стенде; браузер
// с Brotli получает "v10"). Со строгим сравнением такой клиент получал бы 412 на
// любом изменении. Защиту от конфликтов это не ослабляет: ETag — номер версии, а версия
// однозначно определяет состояние заказа, как бы ответ ни сжимали по дороге. Значение
// по-прежнему посимвольное: "v01" ≠ "v1".
export function ifMatchSatisfied(condition: IfMatchCondition, version: number): boolean {
  if (condition.kind === 'any') return true;
  const current = versionEtag(version);
  return condition.tags.some((tag) => (tag.startsWith('W/') ? tag.slice(2) : tag) === current);
}
