import { restaurantSchema } from '@foodster/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { protectedErrorResponses } from '../../http/problem-responses';
import { listRestaurants } from './restaurants.service';

export const restaurantsRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['reference'],
        summary: 'Restaurants for the list filter',
        security: [{ session: [] }],
        response: { 200: z.array(restaurantSchema), ...protectedErrorResponses },
      },
    },
    () => listRestaurants(app.db, app.cache),
  );
  done();
};
