import { loginBodySchema, sessionSchema } from '@foodster/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { unauthorized } from '../../errors';
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
        response: { 200: sessionSchema },
      },
    },
    async (request, reply) => {
      const operator = await authenticateOperator(app.db, request.body);
      if (!operator) throw unauthorized('Invalid operator or password');

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
        response: { 204: z.null().describe('No Content') },
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
        response: { 200: sessionSchema },
      },
    },
    (request) => ({ operator: currentOperator(request) }),
  );
  done();
};
