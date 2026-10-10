import type { ErrorCode } from '@foodster/shared';

// Ожидаемая ошибка с HTTP-статусом и машинным кодом. Обработчик ошибок превращает её
// в ответ application/problem+json (RFC 9457); фронт показывает текст по полю code.
// Коды — из общего списка ERROR_CODES: опечатка в коде не скомпилируется.
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly extensions: Record<string, unknown>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    extensions: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.extensions = extensions;
  }
}

export function unauthorized(message = 'Требуется вход в систему'): AppError {
  return new AppError(401, 'UNAUTHORIZED', message);
}

export function notFound(message = 'Не найдено'): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

// 409: запрос корректен, но противоречит текущему состоянию (бизнес-правило).
export function conflict(
  code: ErrorCode,
  message: string,
  extensions: Record<string, unknown> = {},
): AppError {
  return new AppError(409, code, message, extensions);
}

// 412: версия из If-Match устарела — заказ уже изменил кто-то другой.
export function preconditionFailed(message: string, extensions: Record<string, unknown>): AppError {
  return new AppError(412, 'VERSION_CONFLICT', message, extensions);
}

// 428: изменение без If-Match запрещено — иначе нечем обнаружить конфликт.
export function preconditionRequired(): AppError {
  return new AppError(
    428,
    'PRECONDITION_REQUIRED',
    'Нужен заголовок If-Match с версией заказа (ETag): без него нельзя обнаружить конфликт изменений',
  );
}
