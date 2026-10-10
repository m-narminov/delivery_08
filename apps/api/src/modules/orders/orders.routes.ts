import {
  idParamSchema,
  orderEventSchema,
  orderListQuerySchema,
  orderListSchema,
  orderSchema,
} from '@foodster/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { matchesIfNoneMatch, versionEtag } from '../../http/etag';
import { getOrder, getOrderEvents, listOrders } from './orders.service';

const orderParamsSchema = z.object({ id: idParamSchema });
const security = [{ session: [] }];

export const ordersRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['orders'],
        summary: 'List orders with filters, search, sorting and pagination',
        security,
        querystring: orderListQuerySchema,
        response: { 200: orderListSchema },
      },
    },
    (request) => listOrders(app.db, request.query),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['orders'],
        summary: 'Order details; ETag carries the order version',
        security,
        params: orderParamsSchema,
        // 304 — без тела: send(undefined) не вызывает сериализатор, схема нужна для типов и OpenAPI.
        response: { 200: orderSchema, 304: z.undefined().describe('Not Modified') },
      },
    },
    async (request, reply) => {
      const order = await getOrder(app.db, request.params.id);
      const etag = versionEtag(order.version);
      // private — ответ под сессией оператора, общим кэшам его хранить нельзя;
      // no-cache — браузер может хранить, но перед использованием спрашивает сервер (If-None-Match).
      reply.header('etag', etag).header('cache-control', 'private, no-cache');
      if (matchesIfNoneMatch(request.headers['if-none-match'], etag)) {
        reply.code(304).send(undefined);
        return;
      }
      return order;
    },
  );

  app.get(
    '/:id/events',
    {
      schema: {
        tags: ['orders'],
        summary: 'Order audit log, oldest first',
        security,
        params: orderParamsSchema,
        response: { 200: z.array(orderEventSchema) },
      },
    },
    (request) => getOrderEvents(app.db, request.params.id),
  );

  done();
};
