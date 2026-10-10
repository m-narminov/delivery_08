import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config';
import type { Database } from './db/client';
import { registerErrorHandler } from './http/error-handler';
import { registerSession } from './http/session';
import { registerSwagger } from './http/swagger';
import { logger } from './logger';
import { authRoutes } from './modules/auth/auth.routes';
import { healthRoutes } from './modules/health/health.routes';
import { operatorsRoutes } from './modules/operators/operators.routes';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    config: Config;
  }
}

export interface AppDependencies {
  config: Config;
  db: Database;
  logger?: FastifyBaseLogger;
}

// Сборка приложения без запуска сервера: тесты вызывают buildApp и шлют запросы
// через app.inject(), не открывая порт. Зависимости (БД, конфиг) передаются снаружи.
export async function buildApp({ config, db, logger: appLogger = logger }: AppDependencies) {
  const base = Fastify({
    loggerInstance: appLogger,
    // Id запроса попадает в каждую строку лога этого запроса; входящий X-Request-Id сохраняем.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });
  base.setValidatorCompiler(validatorCompiler);
  base.setSerializerCompiler(serializerCompiler);
  base.decorate('db', db);
  base.decorate('config', config);

  registerErrorHandler(base);
  await registerSwagger(base);
  await registerSession(base, config);

  // Маршруты — инкапсулированные плагины: всё, что зарегистрировано внутри, видно только им.
  const app = base.withTypeProvider<ZodTypeProvider>();
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(operatorsRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  return app;
}
