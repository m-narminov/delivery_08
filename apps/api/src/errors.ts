// Ожидаемая ошибка с HTTP-статусом и машинным кодом. Обработчик ошибок превращает её
// в ответ application/problem+json (RFC 9457); фронт показывает текст по полю code.
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extensions: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
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

export function unauthorized(message = 'Authentication required'): AppError {
  return new AppError(401, 'UNAUTHORIZED', message);
}

export function notFound(message = 'Resource not found'): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}
