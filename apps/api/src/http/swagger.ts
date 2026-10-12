import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { SESSION_COOKIE } from './session';

// z.number().int() в zod 4 — целые в безопасном диапазоне JS, и в JSON Schema попадают границы
// ±9007199254740991. Это не ограничение API, а свойство чисел JS, но Swagger UI подставлял их
// в примеры («version»: 9007199254740991) — из документации убираем.
function withoutSafeIntegerBounds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSafeIntegerBounds);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, item]) =>
          !(key === 'maximum' && item === Number.MAX_SAFE_INTEGER) &&
          !(key === 'minimum' && item === Number.MIN_SAFE_INTEGER),
      )
      .map(([key, item]) => [key, withoutSafeIntegerBounds(item)]),
  );
}

// OpenAPI строится из тех же zod-схем, что проверяют запросы: документация не расходится с кодом.
export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: { title: 'Foodster Ops API', version: '0.1.0' },
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
        },
      },
    },
    transform: jsonSchemaTransform,
    // У нас всегда OpenAPI 3 (опция openapi); ветка swaggerObject — для типа.
    transformObject: (document) =>
      'openapiObject' in document
        ? (withoutSafeIntegerBounds(document.openapiObject) as typeof document.openapiObject)
        : document.swaggerObject,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });
}
