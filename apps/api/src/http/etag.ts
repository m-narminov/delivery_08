// ETag заказа строится из его версии: меняется при каждом изменении заказа.
// Сильный (без W/) — на этапе 6 он пойдёт в If-Match, а там по RFC 9110 сравнение строгое.
export function versionEtag(version: number): string {
  return `"v${version}"`;
}

// no-transform — для ответов с ETag версии. Перед API на Render прокси со сжатием и Cloudflare.
// Замер на стенде (до этой правки): браузер, принимающий Brotli, получал сжатый ответ с сильным
// "v10", а клиент без сжатия — распакованный с ослабленным W/"v10". If-Match сравнивает строго:
// у такого клиента (или за прокси, который убирает Accept-Encoding) любое изменение заказа
// получало бы 412. С no-transform прокси не должны менять ответ (RFC 9111), Cloudflare его не
// сжимает (его документация о сжатии) — и ETag остаётся сильным. Ответы карточки небольшие.
export const NO_TRANSFORM = 'no-transform';

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
export type IfMatchCondition = { kind: 'any' } | { kind: 'tags'; tags: string[] };

// undefined — заголовка нет (→ 428).
export function parseIfMatch(header: string | undefined): IfMatchCondition | undefined {
  if (header === undefined || header.trim() === '') return undefined;
  if (header.trim() === '*') return { kind: 'any' };
  return { kind: 'tags', tags: header.split(',').map((tag) => tag.trim()) };
}

// Строгое сравнение (RFC 9110, 8.8.3.2): ETag совпадает посимвольно. Поэтому "v01" ≠ "v1",
// а слабый W/"v1" не совпадает ни с чем — такой If-Match даёт 412.
export function ifMatchSatisfied(condition: IfMatchCondition, version: number): boolean {
  return condition.kind === 'any' || condition.tags.includes(versionEtag(version));
}
