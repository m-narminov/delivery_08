import { PROBLEM_CONTENT_TYPE, problemSchema, type Problem } from '@foodster/shared';
import type { z } from 'zod';

// Ошибка запроса к API. Тело ошибки (application/problem+json, RFC 9457) проверено общей
// схемой из shared — фронт выбирает реакцию по полю code, а не по тексту.
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | null;

  constructor(status: number, problem: Problem | null) {
    super(problem?.detail ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

// Запрос не дошёл до сервера: нет сети, сервер не отвечает. Отдельный класс, чтобы не путать
// с TypeError из-за ошибки в нашем коде.
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Network request failed', { cause });
    this.name = 'NetworkError';
  }
}

export interface ApiResponse<T> {
  data: T;
  // ETag ответа: версия заказа для If-Match при изменении.
  etag: string | null;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  ifMatch?: string;
  signal?: AbortSignal;
}

async function readProblem(response: Response): Promise<Problem | null> {
  if (!response.headers.get('content-type')?.includes(PROBLEM_CONTENT_TYPE)) return null;
  const result = problemSchema.safeParse(await response.json().catch(() => null));
  return result.success ? result.data : null;
}

// Запрос к API того же источника: cookie сессии браузер отправит сам. Ответ проверяется
// схемой из shared — расхождение с контрактом видно сразу, а не где-то в компоненте.
export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.ifMatch !== undefined) headers['if-match'] = options.ifMatch;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    // Отмену запроса (уход со страницы) пробрасываем как есть — это не сбой сети.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError(error);
  }
  if (!response.ok) throw new ApiError(response.status, await readProblem(response));

  // 204 No Content: тела нет, схема описывает null.
  const body: unknown = response.status === 204 ? null : await response.json();
  return { data: schema.parse(body), etag: response.headers.get('etag') };
}
