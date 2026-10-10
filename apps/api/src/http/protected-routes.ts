import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { couriersRoutes } from '../modules/couriers/couriers.routes';
import { ordersRoutes } from '../modules/orders/orders.routes';
import { restaurantsRoutes } from '../modules/restaurants/restaurants.routes';
import { streamRoutes } from '../modules/stream/stream.routes';

// Все маршруты, требующие сессию. Хук подключён один раз на всю группу (инкапсуляция Fastify):
// новый маршрут внутри защищён по умолчанию, забыть проверку отдельно невозможно.
export const protectedRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  await app.register(ordersRoutes, { prefix: '/orders' });
  await app.register(restaurantsRoutes, { prefix: '/restaurants' });
  await app.register(couriersRoutes, { prefix: '/couriers' });
  await app.register(streamRoutes, { prefix: '/stream' });
};
