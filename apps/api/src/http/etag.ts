// ETag заказа строится из его версии: меняется при каждом изменении заказа.
// Сильный (без W/) — на этапе 6 он пойдёт в If-Match, а там по RFC 9110 сравнение строгое.
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
