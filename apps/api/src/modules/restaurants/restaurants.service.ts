import { restaurantSchema, type Restaurant } from '@foodster/shared';
import { z } from 'zod';
import type { Cache } from '../../cache/cache';
import type { Database } from '../../db/client';
import * as repository from './restaurants.repository';

const restaurantsSchema = z.array(restaurantSchema);

export function listRestaurants(db: Database, cache: Cache): Promise<Restaurant[]> {
  return cache.getOrLoad('restaurants', restaurantsSchema, () => repository.listRestaurants(db));
}
