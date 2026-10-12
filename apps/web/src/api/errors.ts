import { ERROR_CODES, type ErrorCode } from '@foodster/shared';
import { ApiError, NetworkError } from './client';

const UNAVAILABLE = 'Сервис временно недоступен. Попробуйте через несколько секунд';
const INTERNAL = 'На сервере произошла ошибка. Попробуйте ещё раз или обратитесь в поддержку';

// Системные ошибки API приходят с английским detail — для них свой текст.
const SYSTEM_MESSAGES: Partial<Record<ErrorCode, string>> = {
  INTERNAL_ERROR: INTERNAL,
  // Тело запроса не разобрано (битый JSON) — detail от Fastify, по-английски.
  BAD_REQUEST: 'Сервер не смог разобрать запрос. Обновите страницу и попробуйте ещё раз',
  SERVICE_UNAVAILABLE: UNAVAILABLE,
};

const knownCodes: readonly string[] = ERROR_CODES;

function isErrorCode(code: string): code is ErrorCode {
  return knownCodes.includes(code);
}

export function errorMessage(error: unknown): string {
  if (error instanceof NetworkError) return 'Нет связи с сервером. Проверьте подключение';
  if (!(error instanceof ApiError)) return 'Что-то пошло не так';

  const problem = error.problem;
  if (problem && isErrorCode(problem.code)) {
    // Наши коды: бизнес-правила и валидация приходят с русским detail, системные — нет.
    return SYSTEM_MESSAGES[problem.code] ?? problem.detail;
  }
  // Без нашего тела ошибки (код не из ERROR_CODES или не problem+json): ответ Fastify
  // с английским текстом, прокси или балансировщик. 502–504 — сервер API недоступен
  // (в dev так отвечает прокси Vite, пока API перезапускается).
  if (error.status === 502 || error.status === 503 || error.status === 504) return UNAVAILABLE;
  if (error.status >= 500) return INTERNAL;
  return `Запрос отклонён сервером (HTTP ${error.status})`;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
