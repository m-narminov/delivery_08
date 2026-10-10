import { operatorOptionSchema } from '@foodster/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { commonErrorResponses } from '../../http/problem-responses';
import { listOperatorOptions } from './operators.repository';

// Публичный маршрут: список нужен экрану входа до того, как появилась сессия.
export const operatorsRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/operators',
    {
      schema: {
        tags: ['auth'],
        summary: 'Operators for the login screen',
        response: { 200: z.array(operatorOptionSchema), ...commonErrorResponses },
      },
    },
    () => listOperatorOptions(app.db),
  );
  done();
};
