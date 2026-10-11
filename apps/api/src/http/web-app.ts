import { relative, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// Файлы сборки Vite с хэшем в имени (assets/index-3f2a1c.js) не меняются никогда: новая версия —
// новое имя. Их браузер и прокси хранят год. Остальное (index.html, логотип) перепроверяется
// при каждом открытии, иначе после деплоя браузер показывал бы старую страницу со ссылками
// на уже удалённые файлы.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

// Собранный фронт отдаёт само API: один сервис на Render, один источник — cookie сессии
// и SSE работают без CORS. Только в production; в разработке фронт отдаёт Vite.
export async function registerWebApp(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, {
    root,
    // Свои заголовки кэширования вместо стандартного «public, max-age=0».
    cacheControl: false,
    // filePath — абсолютный: смотрим путь внутри root, иначе папка assets где-то выше root
    // (например, /srv/assets/site/dist) сделала бы «вечным» и index.html.
    setHeaders: (reply, filePath) => {
      const hashed = relative(root, filePath).startsWith(`assets${sep}`);
      reply.header('cache-control', hashed ? IMMUTABLE : REVALIDATE);
    },
  });
}

// Адрес страницы фронта (/orders/26, /login): файла с таким именем нет, отдаём index.html —
// дальше маршрут разбирает роутер фронта. Только для GET/HEAD вне /api и только если браузер
// ждёт HTML: запросу к API или к отсутствующему файлу (картинке, скрипту) честнее получить 404.
export function isWebAppRoute(request: FastifyRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  // request.url — вместе со строкой запроса: /api?x=1 тоже запрос к API.
  const path = request.url.replace(/\?.*$/s, '');
  if (path === '/api' || path.startsWith('/api/')) return false;
  return request.headers.accept?.includes('text/html') ?? false;
}

export function sendWebApp(reply: FastifyReply) {
  return reply.header('cache-control', REVALIDATE).sendFile('index.html');
}
