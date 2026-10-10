import {
  cancelBodySchema,
  courierBodySchema,
  idParamSchema,
  orderEventSchema,
  orderListQuerySchema,
  orderListSchema,
  orderSchema,
  transitionBodySchema,
} from '@foodster/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { matchesIfNoneMatch, versionEtag } from '../../http/etag';
import {
  orderErrorResponses,
  orderMutationErrorResponses,
  protectedErrorResponses,
} from '../../http/problem-responses';
import { currentOperator } from '../../http/session';
import {
  cancelOrder,
  changeOrderCourier,
  changeOrderStatus,
  type MutationTarget,
} from './orders.commands';
import { getOrder, getOrderEvents, listOrders } from './orders.service';

const orderParamsSchema = z.object({ id: idParamSchema });
const security = [{ session: [] }];
// Описан для OpenAPI; отсутствие заголовка обрабатывает команда (428), а не валидация (400).
const ifMatchHeadersSchema = z.object({
  'if-match': z.string().optional().describe('ETag of the order version being modified, e.g. "v3"'),
});

export const ordersRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['orders'],
        summary: 'List orders with filters, search, sorting and pagination',
        security,
        querystring: orderListQuerySchema,
        response: { 200: orderListSchema, ...protectedErrorResponses },
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
        response: {
          200: orderSchema,
          304: z.undefined().describe('Not Modified'),
          ...orderErrorResponses,
        },
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
        response: { 200: z.array(orderEventSchema), ...orderErrorResponses },
      },
    },
    (request) => getOrderEvents(app.db, request.params.id),
  );

  // Изменения: If-Match обязателен (428 без него, 412 при устаревшей версии), ответ — заказ
  // с новым ETag. Автор изменения для audit — оператор текущей сессии.
  const target = (request: FastifyRequest<{ Params: { id: number } }>): MutationTarget => ({
    orderId: request.params.id,
    ifMatch: request.headers['if-match'],
    actorId: currentOperator(request).id,
  });

  app.post(
    '/:id/transitions',
    {
      schema: {
        tags: ['orders'],
        summary: 'Move the order to the next status',
        security,
        params: orderParamsSchema,
        headers: ifMatchHeadersSchema,
        body: transitionBodySchema,
        response: { 200: orderSchema, ...orderMutationErrorResponses },
      },
    },
    async (request, reply) => {
      const { order } = await changeOrderStatus(app.db, target(request), request.body.to);
      reply.header('etag', versionEtag(order.version));
      return order;
    },
  );

  app.put(
    '/:id/courier',
    {
      schema: {
        tags: ['orders'],
        summary: 'Assign, change or remove (null) the courier',
        security,
        params: orderParamsSchema,
        headers: ifMatchHeadersSchema,
        body: courierBodySchema,
        response: { 200: orderSchema, ...orderMutationErrorResponses },
      },
    },
    async (request, reply) => {
      const { order } = await changeOrderCourier(app.db, target(request), request.body.courierId);
      reply.header('etag', versionEtag(order.version));
      return order;
    },
  );

  app.post(
    '/:id/cancel',
    {
      schema: {
        tags: ['orders'],
        summary: 'Cancel the order (only before pickup)',
        security,
        params: orderParamsSchema,
        headers: ifMatchHeadersSchema,
        body: cancelBodySchema,
        response: { 200: orderSchema, ...orderMutationErrorResponses },
      },
    },
    async (request, reply) => {
      const { order } = await cancelOrder(app.db, target(request), request.body.reason);
      reply.header('etag', versionEtag(order.version));
      return order;
    },
  );

  done();
};
