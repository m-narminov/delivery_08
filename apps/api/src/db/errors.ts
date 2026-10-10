// Ошибки, после которых запрос имеет смысл повторить позже: база недоступна, перегружена
// или не дождалась блокировки. Клиенту это 503 + Retry-After, а не 500 «у нас баг».

// SQLSTATE: https://www.postgresql.org/docs/current/errcodes-appendix.html
const RETRYABLE_SQLSTATES = new Set([
  '53300', // too_many_connections
  '55P03', // lock_not_available — сработал lock_timeout
  '57014', // query_canceled — сработал statement_timeout
  '57P01', // admin_shutdown — сервер БД останавливается или перезапускается
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now — сервер БД ещё запускается
]);

// Сетевые ошибки Node при подключении.
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

// У этих ошибок драйвера pg и пула pg-pool нет кода — только текст (node_modules/pg-pool/index.js,
// node_modules/pg/lib/client.js). Сверять текст хрупко, но другого признака нет.
const DRIVER_MESSAGES = new Set([
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
  'Connection terminated unexpectedly',
]);

function isRetryable(error: Error): boolean {
  if (DRIVER_MESSAGES.has(error.message)) return true;
  if (!('code' in error) || typeof error.code !== 'string') return false;
  const { code } = error;
  // Класс 08 — connection exception: соединение с БД потеряно или не установлено.
  return RETRYABLE_SQLSTATES.has(code) || NETWORK_ERROR_CODES.has(code) || code.startsWith('08');
}

// Drizzle оборачивает ошибку драйвера (исходная — в cause), поэтому проверяем всю цепочку.
export function isDatabaseUnavailable(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (isRetryable(current)) return true;
  }
  return false;
}
