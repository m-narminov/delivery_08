import './zod-locale';
import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyBaseLogger } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config';
import type { Database } from './db/client';
import { registerErrorHandler } from './http/error-handler';
import { protectedRoutes } from './http/protected-routes';
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

const HEALTH_PATH = '/api/health';
const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

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
    // Render опрашивает health check постоянно: автоматические записи о таких запросах
    // (incoming request / request completed) не пишем. Явные логи маршрута остаются.
    logController: new LogController({
      disableRequestLogging: (request) => request.routeOptions.url === HEALTH_PATH,
    }),
    // Id запроса попадает в каждую строку лога этого запроса. Входящий X-Request-Id
    // принимаем только в безопасном формате, иначе генерируем свой.
    requestIdHeader: false,
    // За прокси IP клиента — в X-Forwarded-For; заголовок принимаем только от указанных прокси.
    trustProxy: config.TRUST_PROXY ?? false,
    genReqId: (request) => {
      const incoming = request.headers[REQUEST_ID_HEADER];
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();
    },
  });
  base.setValidatorCompiler(validatorCompiler);
  base.setSerializerCompiler(serializerCompiler);
  base.decorate('db', db);
  base.decorate('config', config);

  // Id запроса в ответе: по нему легко найти запрос в логах.
  base.addHook('onRequest', (request, reply, done) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });
  // Ответы API — данные под сессией оператора, которые быстро устаревают: по умолчанию их
  // не хранит ни браузер, ни прокси. Маршрут может задать своё (карточка заказа — с ETag).
  base.addHook('onSend', (_request, reply, payload, done) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    done(null, payload);
  });
  registerErrorHandler(base);
  await registerSwagger(base);
  await registerSession(base, config);

  // Маршруты — инкапсулированные плагины: всё, что зарегистрировано внутри, видно только им.
  const app = base.withTypeProvider<ZodTypeProvider>();
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(operatorsRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(protectedRoutes, { prefix: '/api' });
  return app;
}
