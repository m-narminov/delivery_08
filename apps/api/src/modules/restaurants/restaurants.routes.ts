import { restaurantSchema, type Restaurant } from '@foodster/shared';
import { asc } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client';
import { restaurants } from '../../db/schema';

export async function listRestaurants(db: Database): Promise<Restaurant[]> {
  return db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .orderBy(asc(restaurants.name), asc(restaurants.id));
}

export const restaurantsRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['reference'],
        summary: 'Restaurants for the list filter',
        security: [{ session: [] }],
        response: { 200: z.array(restaurantSchema) },
      },
    },
    () => listRestaurants(app.db),
  );
  done();
};
