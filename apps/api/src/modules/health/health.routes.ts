import { sql } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthSchema = z.object({ status: z.enum(['ok', 'unavailable']) });

// Health check для Render: жив ли процесс и доступна ли БД.
export const healthRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/health',
    {
      // Render опрашивает health check постоянно — не засоряем логи успешными запросами.
      logLevel: 'warn',
      schema: {
        tags: ['system'],
        summary: 'Health check',
        response: { 200: healthSchema, 503: healthSchema },
      },
    },
    async (request, reply) => {
      try {
        await app.db.execute(sql`select 1`);
        return { status: 'ok' as const };
      } catch (error) {
        request.log.error({ err: error }, 'Database health check failed');
        return reply.code(503).send({ status: 'unavailable' });
      }
    },
  );
  done();
};
