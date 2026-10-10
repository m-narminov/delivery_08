import { courierSchema, type Courier } from '@foodster/shared';
import { z } from 'zod';
import type { Cache } from '../../cache/cache';
import type { Database } from '../../db/client';
import * as repository from './couriers.repository';

const courierProfilesSchema = z.array(courierSchema.omit({ activeDeliveries: true }));

// Профили курьеров — из кэша, число активных доставок — всегда свежее из БД: по нему оператор
// выбирает курьера с учётом лимита, устаревшее значение вводило бы в заблуждение.
export async function listCouriers(db: Database, cache: Cache): Promise<Courier[]> {
  const [profiles, activeDeliveries] = await Promise.all([
    cache.getOrLoad('couriers', courierProfilesSchema, () => repository.listCourierProfiles(db)),
    repository.countActiveDeliveriesByCourier(db),
  ]);
  return profiles.map((profile) => ({
    ...profile,
    activeDeliveries: activeDeliveries.get(profile.id) ?? 0,
  }));
}
