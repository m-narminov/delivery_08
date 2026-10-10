import { ACTIVE_DELIVERY_STATUSES, courierSchema, type Courier } from '@foodster/shared';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client';
import { couriers, orders } from '../../db/schema';

// Курьеры с числом активных доставок одним запросом: LEFT JOIN только активных заказов
// и count по ним. У курьера без активных заказов — 0 (count не считает NULL).
export async function listCouriers(db: Database): Promise<Courier[]> {
  return db
    .select({
      id: couriers.id,
      name: couriers.name,
      phone: couriers.phone,
      activeDeliveries: count(orders.id),
    })
    .from(couriers)
    .leftJoin(
      orders,
      and(eq(orders.courierId, couriers.id), inArray(orders.status, [...ACTIVE_DELIVERY_STATUSES])),
    )
    .groupBy(couriers.id)
    .orderBy(asc(couriers.name), asc(couriers.id));
}

export const couriersRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['reference'],
        summary: 'Couriers with the number of active deliveries',
        security: [{ session: [] }],
        response: { 200: z.array(courierSchema) },
      },
    },
    () => listCouriers(app.db),
  );
  done();
};
