import {
  loginBodySchema,
  problemSchema,
  PROBLEM_CONTENT_TYPE,
  sessionSchema,
} from '@foodster/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, unauthorized } from '../../errors';
import { commonErrorResponses, protectedErrorResponses } from '../../http/problem-responses';
import { currentOperator, SESSION_COOKIE, sessionCookieOptions } from '../../http/session';
import { authenticateOperator } from './auth.service';

// Попыток входа с одного IP (для IPv6 — с одной подсети /64) за окно. Проверка пароля (scrypt) намеренно дорогая: на 0.1 CPU
// Render это десятые доли секунды, и поток входов загрузил бы процессор целиком. Пять в минуту
// человеку хватает с запасом (ошибся, ввёл ещё раз), а подбор и нагрузку отсекает.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60_000;

// Откуда пришёл вход — в каждой записи о входе. ip — адрес, по которому считается лимит;
// рядом — из чего он получен: адрес соединения и цепочка прокси. По этим полям на Render
// выбирается TRUST_PROXY (кто стоит между клиентом и нами) и видно, откуда идёт подбор.
// Заголовки присылает клиент, и длиной до лимита Node (16 КБ на все заголовки): в лог — только
// начало, иначе каждый отказ по лимиту писал бы в лог килобайты мусора атакующего.
const LOGGED_HEADER_MAX_LENGTH = 256;

function headerForLog(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value.join(', ') : value;
  return text !== undefined && text.length > LOGGED_HEADER_MAX_LENGTH
    ? `${text.slice(0, LOGGED_HEADER_MAX_LENGTH)}…`
    : text;
}

function clientAddressFields(request: FastifyRequest) {
  return {
    ip: request.ip,
    socketAddress: request.socket.remoteAddress,
    forwardedFor: headerForLog(request.headers['x-forwarded-for']),
    cfConnectingIp: headerForLog(request.headers['cf-connecting-ip']),
  };
}

export const authRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.post(
    '/login',
    {
      // Считаются все попытки, и удачные тоже: проверяется до разбора тела, по IP клиента.
      // За прокси (Render) IP берётся из X-Forwarded-For только при заданном TRUST_PROXY —
      // иначе все клиенты были бы для лимита одним адресом прокси.
      config: {
        rateLimit: {
          max: LOGIN_MAX_ATTEMPTS,
          timeWindow: LOGIN_WINDOW_MS,
          // Отказ по лимиту — отдельной строкой: так в логе видно подбор или нагрузку на вход.
          onExceeded: (request) => {
            request.log.warn(clientAddressFields(request), 'Login rate limit exceeded');
          },
          // Плагин уже выставил Retry-After и X-RateLimit-*; ответ соберёт общий обработчик
          // ошибок (problem+json).
          errorResponseBuilder: (_request, context) =>
            new AppError(
              429,
              'LOGIN_RATE_LIMITED',
              `Слишком много попыток входа. Повторите через ${Math.ceil(context.ttl / 1000)} с`,
            ),
        },
      },
      schema: {
        tags: ['auth'],
        summary: 'Log in as an operator',
        body: loginBodySchema,
        response: {
          200: sessionSchema,
          ...commonErrorResponses,
          429: {
            description: `LOGIN_RATE_LIMITED: more than ${LOGIN_MAX_ATTEMPTS} attempts per minute from one IP; see Retry-After`,
            content: { [PROBLEM_CONTENT_TYPE]: { schema: problemSchema } },
          },
        },
      },
    },
    async (request, reply) => {
      const operator = await authenticateOperator(app.db, request.body);
      if (!operator) {
        // Неудачные входы видны в логах: так заметен подбор пароля. Пароль в лог не пишем.
        request.log.warn(
          { operatorId: request.body.operatorId, ...clientAddressFields(request) },
          'Login failed',
        );
        throw unauthorized('Неверный оператор или пароль');
      }

      const token = await reply.jwtSign({ operatorId: operator.id, name: operator.name });
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(app.config));
      request.log.info(
        { operatorId: operator.id, ...clientAddressFields(request) },
        'Operator logged in',
      );
      return { operator };
    },
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Log out',
        response: { 204: z.null().describe('No Content'), ...commonErrorResponses },
      },
    },
    (_request, reply) => {
      reply.clearCookie(SESSION_COOKIE, { path: '/' }).code(204);
      // При 204 Fastify отбрасывает тело и заголовки content-type/content-length.
      return null;
    },
  );

  app.get(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Current operator',
        security: [{ session: [] }],
        response: { 200: sessionSchema, ...protectedErrorResponses },
      },
    },
    (request) => ({ operator: currentOperator(request) }),
  );
  done();
};
