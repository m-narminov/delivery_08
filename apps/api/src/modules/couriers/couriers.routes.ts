import { courierSchema } from '@foodster/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { protectedErrorResponses } from '../../http/problem-responses';
import { listCouriers } from './couriers.repository';

export const couriersRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['reference'],
        summary: 'Couriers with the number of active deliveries',
        security: [{ session: [] }],
        response: { 200: z.array(courierSchema), ...protectedErrorResponses },
      },
    },
    () => listCouriers(app.db),
  );
  done();
};
