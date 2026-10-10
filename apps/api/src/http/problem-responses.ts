import {
  badRequestProblemSchema,
  courierLimitProblemSchema,
  PROBLEM_CONTENT_TYPE,
  problemSchema,
  versionConflictProblemSchema,
} from '@foodster/shared';
import type { z } from 'zod';

// Ответы с ошибками для схем маршрутов. Одна схема и описывает ошибку в OpenAPI, и проверяет
// тело ответа при сериализации. Ключ — тип содержимого: Fastify выбирает схему и по статусу,
// и по Content-Type, а обработчик ошибок отвечает application/problem+json.
function problemResponse<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { [PROBLEM_CONTENT_TYPE]: { schema } } };
}

// Любой маршрут: невалидный запрос, прочие 4xx, ошибка сервера или недоступная БД.
export const commonErrorResponses = {
  400: problemResponse(
    badRequestProblemSchema,
    'VALIDATION_FAILED (field errors in `errors`) or BAD_REQUEST (malformed body)',
  ),
  '4xx': problemResponse(problemSchema, 'Other client errors; `code` is derived from the status'),
  '5xx': problemResponse(
    problemSchema,
    'INTERNAL_ERROR, or SERVICE_UNAVAILABLE with Retry-After when the database is unavailable',
  ),
};

// Маршруты под сессией.
export const protectedErrorResponses = {
  ...commonErrorResponses,
  401: problemResponse(problemSchema, 'UNAUTHORIZED: no session, expired or unknown operator'),
};

// Маршруты одного заказа.
export const orderErrorResponses = {
  ...protectedErrorResponses,
  404: problemResponse(problemSchema, 'NOT_FOUND: the order does not exist'),
};

// Изменения заказа: бизнес-правила, версия и обязательный If-Match.
export const orderMutationErrorResponses = {
  ...orderErrorResponses,
  404: problemResponse(problemSchema, 'NOT_FOUND (order) or COURIER_NOT_FOUND'),
  409: problemResponse(
    problemSchema.or(courierLimitProblemSchema),
    'Business rule violated: TRANSITION_NOT_ALLOWED, COURIER_REQUIRED, COURIER_NOT_EDITABLE, ' +
      'COURIER_LIMIT_REACHED (with courier, activeDeliveries, limit)',
  ),
  412: problemResponse(
    versionConflictProblemSchema,
    'VERSION_CONFLICT: If-Match is stale; `current` is the order now, `lastChange` says who changed it',
  ),
  428: problemResponse(problemSchema, 'PRECONDITION_REQUIRED: the If-Match header is missing'),
};
