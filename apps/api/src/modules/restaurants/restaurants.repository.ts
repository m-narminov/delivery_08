import type { Restaurant } from '@foodster/shared';
import { asc } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { restaurants } from '../../db/schema';

export async function listRestaurants(db: Database): Promise<Restaurant[]> {
  return db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .orderBy(asc(restaurants.name), asc(restaurants.id));
}
