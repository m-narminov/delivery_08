import { loginBodySchema, sessionSchema } from '@foodster/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { unauthorized } from '../../errors';
import { commonErrorResponses, protectedErrorResponses } from '../../http/problem-responses';
import { currentOperator, SESSION_COOKIE, sessionCookieOptions } from '../../http/session';
import { authenticateOperator } from './auth.service';

export const authRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Log in as an operator',
        body: loginBodySchema,
        response: { 200: sessionSchema, ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      const operator = await authenticateOperator(app.db, request.body);
      if (!operator) {
        // Неудачные входы видны в логах: так заметен подбор пароля. Пароль в лог не пишем.
        request.log.warn({ operatorId: request.body.operatorId }, 'Login failed');
        throw unauthorized('Неверный оператор или пароль');
      }

      const token = await reply.jwtSign({ operatorId: operator.id, name: operator.name });
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(app.config));
      request.log.info({ operatorId: operator.id }, 'Operator logged in');
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
