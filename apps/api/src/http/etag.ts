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
