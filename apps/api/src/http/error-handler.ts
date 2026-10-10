import { STATUS_CODES } from 'node:http';
import type { FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  ResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../errors';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

// Формат ошибки по RFC 9457 (Problem Details). code — наш машинный код для фронта.
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  [extension: string]: unknown;
}

function problem(
  status: number,
  code: string,
  detail: string,
  instance: string,
  extensions: Record<string, unknown> = {},
): Problem {
  // Расширения разворачиваются первыми: перезаписать стандартные поля они не могут.
  // Для type: about:blank RFC 9457 рекомендует title = стандартная фраза HTTP-статуса.
  return {
    ...extensions,
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    detail,
    instance,
    code,
  };
}

// Стабильный код из статуса: BAD_REQUEST, PAYLOAD_TOO_LARGE, … — внутренние коды
// Fastify (FST_ERR_…) остаются деталью реализации и в контракт API не входят.
function codeFromStatus(status: number): string {
  return (STATUS_CODES[status] ?? 'Error').toUpperCase().replace(/[^A-Z]+/g, '_');
}

// Ошибка Fastify или плагина с кодом 4xx: битый JSON, неверный Content-Type, большое тело.
function clientErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || !('statusCode' in error)) return undefined;
  const { statusCode } = error;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined;
}

// Заголовки, которые ошибка просит выставить (например, Retry-After).
function errorHeaders(error: unknown): Record<string, string> {
  if (!(error instanceof Error) || !('headers' in error)) return {};
  const { headers } = error;
  if (typeof headers !== 'object' || headers === null) return {};
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

// В обработчик может прийти что угодно: throw 'строка', Promise.reject(null) — поэтому unknown.
function toProblem(error: unknown, instance: string): Problem {
  if (error instanceof AppError) {
    return problem(error.status, error.code, error.message, instance, error.extensions);
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    return problem(400, 'VALIDATION_FAILED', 'Request validation failed', instance, {
      errors: error.validation.map((issue) => ({
        location: error.validationContext,
        path: issue.instancePath,
        message: issue.message,
      })),
    });
  }
  // Ответ не прошёл схему — это баг сервера, а не клиента: детали только в лог.
  if (error instanceof ResponseSerializationError) {
    return problem(500, 'INTERNAL_ERROR', 'Internal server error', instance);
  }
  const status = clientErrorStatus(error);
  if (status !== undefined && error instanceof Error) {
    return problem(status, codeFromStatus(status), error.message, instance);
  }
  // Всё остальное — неожиданная ошибка: клиенту без подробностей, чтобы не утекли детали.
  return problem(500, 'INTERNAL_ERROR', 'Internal server error', instance);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const body = toProblem(error, request.url);
    if (body.status >= 500) {
      request.log.error({ err: error }, 'Request failed');
    }
    return reply
      .code(body.status)
      .headers(body.status < 500 ? errorHeaders(error) : {})
      .type(PROBLEM_CONTENT_TYPE)
      .send(body);
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .type(PROBLEM_CONTENT_TYPE)
      .send(
        problem(404, 'NOT_FOUND', `Route ${request.method} ${request.url} not found`, request.url),
      ),
  );
}
