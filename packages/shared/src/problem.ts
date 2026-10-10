import { z } from 'zod';
import { MAX_ACTIVE_DELIVERIES_PER_COURIER } from './order-rules';
import { orderEventSchema, orderSchema, referenceSchema } from './schemas';

// Ошибки API — application/problem+json по RFC 9457: стандартные поля + наш машинный code.
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

// Коды, которые API выставляет само. По ним фронт выбирает текст и реакцию, а не по detail.
// Прочие ошибки 4xx получают код из HTTP-статуса: PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE, …
export const ERROR_CODES = [
  // 400: поля запроса не прошли проверку, список — в errors
  'VALIDATION_FAILED',
  // 400: тело не разобрано (битый JSON)
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'COURIER_NOT_FOUND',
  // 409: бизнес-правила
  'TRANSITION_NOT_ALLOWED',
  'COURIER_REQUIRED',
  'COURIER_NOT_EDITABLE',
  'COURIER_LIMIT_REACHED',
  // 412: версия из If-Match устарела
  'VERSION_CONFLICT',
  // 428: изменение без If-Match
  'PRECONDITION_REQUIRED',
  'INTERNAL_ERROR',
  // 503: база данных недоступна или перегружена, можно повторить позже
  'SERVICE_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// looseObject: у конкретных ошибок есть дополнительные поля (RFC 9457 называет их extension
// members), и при сериализации ответа их нельзя отбрасывать.
export const problemSchema = z.looseObject({
  type: z.string(),
  // Стандартная фраза HTTP-статуса: Not Found, Conflict, …
  title: z.string(),
  status: z.number().int(),
  // Текст для человека; для ошибок, которые видит оператор, — по-русски.
  detail: z.string(),
  instance: z.string(),
  code: z.string().describe('One of ERROR_CODES, or derived from the HTTP status'),
});

export const validationIssueSchema = z.object({
  location: z.string().describe('body, querystring, params or headers'),
  path: z.string().describe('JSON Pointer to the field, e.g. /operatorId'),
  message: z.string(),
});

// 400: у VALIDATION_FAILED есть список ошибок по полям, у BAD_REQUEST (битый JSON) — нет.
export const badRequestProblemSchema = problemSchema.extend({
  errors: z.array(validationIssueSchema).optional(),
});

// 412: актуальный заказ и последнее изменение с автором — фронт покажет, кто его опередил.
// null — только если заказ успели удалить.
export const versionConflictProblemSchema = problemSchema.extend({
  current: orderSchema.nullable(),
  lastChange: orderEventSchema.nullable(),
});

// 409 COURIER_LIMIT_REACHED: сколько у курьера активных доставок и какой лимит.
export const courierLimitProblemSchema = problemSchema.extend({
  courier: referenceSchema,
  activeDeliveries: z.number().int().nonnegative(),
  limit: z.literal(MAX_ACTIVE_DELIVERIES_PER_COURIER),
});

export type Problem = z.infer<typeof problemSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type BadRequestProblem = z.infer<typeof badRequestProblemSchema>;
export type VersionConflictProblem = z.infer<typeof versionConflictProblemSchema>;
export type CourierLimitProblem = z.infer<typeof courierLimitProblemSchema>;
