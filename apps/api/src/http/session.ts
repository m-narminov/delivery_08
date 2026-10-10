import cookie, { type CookieSerializeOptions } from '@fastify/cookie';
import jwt from '@fastify/jwt';
import type { Operator } from '@foodster/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { unauthorized } from '../errors';
import { findOperatorById, toOperatorDto } from '../modules/operators/operators.repository';

export const SESSION_COOKIE = 'foodster_session';

export interface SessionPayload {
  operatorId: number;
  name: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionPayload;
    user: SessionPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    // Хук для защищённых маршрутов: без валидной сессии или без оператора в БД — 401.
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    // Заполняет authenticate; вне защищённых маршрутов — null.
    operator: Operator | null;
  }
}

// Сессия — подписанный JWT в httpOnly-cookie:
// - httpOnly: JS на странице не может прочитать токен (защита от кражи через XSS);
// - SameSite=Lax: браузер не пришлёт cookie в POST/PUT с чужого сайта (защита от CSRF);
// - Secure (по умолчанию включён, см. COOKIE_SECURE): cookie уходит только по HTTPS.
export function sessionCookieOptions(config: Config): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    maxAge: config.SESSION_TTL_HOURS * 60 * 60,
  };
}

export async function registerSession(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    // Только cookie: заголовок Authorization: Bearer не должен быть вторым способом входа.
    verify: { onlyCookie: true },
    sign: { expiresIn: `${config.SESSION_TTL_HOURS}h` },
  });

  // Начальное значение null, а не объект: один объект достался бы всем запросам сразу.
  app.decorateRequest('operator', null);

  app.decorate('authenticate', async (request: FastifyRequest) => {
    let session: SessionPayload;
    try {
      session = await request.jwtVerify<SessionPayload>();
    } catch {
      throw unauthorized();
    }
    // Подпись проверяет только, что токен выдали мы. Оператора берём из БД: удалённый
    // оператор не должен оставаться в системе, а audit должен ссылаться на существующего.
    const row = await findOperatorById(app.db, session.operatorId);
    if (!row) throw unauthorized();
    request.operator = toOperatorDto(row);
  });
}

// Оператор текущего запроса. На защищённых маршрутах его гарантирует authenticate;
// если хук забыли подключить — 401, а не TypeError и 500.
export function currentOperator(request: FastifyRequest): Operator {
  if (!request.operator) throw unauthorized();
  return request.operator;
}
