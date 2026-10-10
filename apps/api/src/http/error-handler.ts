import type { FastifyError, FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../errors';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  409: 'Conflict',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  428: 'Precondition Required',
  500: 'Internal Server Error',
};

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
  const title = STATUS_TITLES[status] ?? 'Error';
  return { type: 'about:blank', title, status, detail, instance, code, ...extensions };
}

function isClientError(error: FastifyError): boolean {
  return typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500;
}

function toProblem(error: FastifyError, instance: string): Problem {
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
  if (isResponseSerializationError(error)) {
    return problem(500, 'INTERNAL_ERROR', 'Internal server error', instance);
  }
  // Ошибки самого Fastify с кодом 4xx: битый JSON, слишком большое тело, неверный Content-Type.
  if (isClientError(error)) {
    return problem(error.statusCode ?? 400, error.code, error.message, instance);
  }
  // Всё остальное — неожиданная ошибка: клиенту без подробностей, чтобы не утекли детали.
  return problem(500, 'INTERNAL_ERROR', 'Internal server error', instance);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const body = toProblem(error, request.url);
    if (body.status >= 500) {
      request.log.error({ err: error }, 'Request failed');
    }
    return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
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
