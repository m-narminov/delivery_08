import {
  ORDER_CHANGED_EVENT,
  orderChangedEventSchema,
  problemSchema,
  STREAM_PING_EVENT,
  STREAM_PING_INTERVAL_MS,
} from '@foodster/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { AppError } from '../../errors';
import { problemResponse, protectedErrorResponses } from '../../http/problem-responses';
import { currentOperator } from '../../http/session';

// Через сколько миллисекунд браузер переподключится после обрыва (поле retry в SSE).
const RECONNECT_MS = 3_000;
// Каждый поток держит сокет, подписку и таймер. Стенд публичный (вход с общим паролем),
// поэтому число потоков ограничено: на оператора — несколько вкладок, всего — с запасом
// на всю смену операторов. На оператора — с запасом: за прокси (Render) сервер узнаёт о
// закрытии потока с задержкой, и частые F5 или новые вкладки при 5 упирались в лимит.
export const MAX_STREAMS_PER_OPERATOR = 10;
const MAX_STREAMS = 200;
// Медленный клиент или «полуоткрытое» соединение: данные копятся в памяти сервера.
// Больше этого — закрываем поток; браузер переподключится и перезапросит данные.
const MAX_BUFFERED_BYTES = 256 * 1024;

// Server-Sent Events: одно долгое HTTP-соединение, по которому сервер присылает события
// «заказ изменился». Браузер подключается через EventSource и сам переподключается после обрыва.
// Истории событий нет: после переподключения фронт перезапрашивает данные.
export const streamRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  // Открытые потоки: функция закрытия → id оператора.
  const streams = new Map<() => void, number>();

  // SSE-соединение само не завершается, и server.close() ждал бы его вечно. Поэтому при
  // остановке приложения потоки закрываем сами.
  app.addHook('preClose', (hookDone) => {
    for (const close of streams.keys()) close();
    hookDone();
  });

  app.get(
    '/',
    {
      // Fastify по умолчанию отвечает и на HEAD тем же обработчиком: открылась бы подписка
      // с таймером, а Node отбросил бы всё, что мы пишем в ответ на HEAD.
      exposeHeadRoute: false,
      schema: {
        tags: ['orders'],
        summary: 'Server-Sent Events: order.changed after every order change',
        security: [{ session: [] }],
        response: {
          200: {
            description: `Event stream; each "${ORDER_CHANGED_EVENT}" event carries this JSON in data`,
            content: { 'text/event-stream': { schema: orderChangedEventSchema } },
          },
          ...protectedErrorResponses,
          429: problemResponse(
            problemSchema,
            'STREAM_LIMIT_REACHED: too many open streams for this operator',
          ),
        },
      },
    },
    (request, reply) => {
      const operatorId = currentOperator(request).id;
      // Лимиты проверяем до hijack: пока ответ ещё у Fastify, ошибка уйдёт обычным problem+json.
      if (streams.size >= MAX_STREAMS) {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Too many open event streams');
      }
      const ownStreams = [...streams.values()].filter((id) => id === operatorId).length;
      if (ownStreams >= MAX_STREAMS_PER_OPERATOR) {
        throw new AppError(
          429,
          'STREAM_LIMIT_REACHED',
          'Открыто слишком много вкладок с live-обновлениями: закройте лишние',
        );
      }

      // Дальше ответ пишем сами, в сыром потоке Node: Fastify его не сериализует и не завершает.
      // Поэтому заголовки, выставленные через reply (x-request-id из onRequest, Cache-Control из
      // onSend), сюда не доходят — задаём их здесь.
      reply.hijack();
      const response = reply.raw;
      // Клиент мог уйти, пока проверялась сессия (запрос в БД): событие 'close' уже было,
      // и подписка с таймером остались бы висеть до остановки сервера.
      if (response.destroyed) return;

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        // no-transform — просьба к прокси не сжимать поток: сжатие копит данные в буфер, и события
        // доходили бы пачками с задержкой.
        'cache-control': 'no-store, no-transform',
        'x-request-id': request.id,
        // Соединение — только под этот поток. С keep-alive после конца потока (остановка
        // сервера, истечение сессии) сокет остался бы открытым до keepAliveTimeout
        // (у Fastify 72 с), и server.close() ждал бы его. С close Node закрывает сокет сразу
        // после ответа (resOnFinish → socket.destroySoon()).
        connection: 'close',
        // Подсказка nginx-подобным прокси не буферизовать поток.
        'x-accel-buffering': 'no',
      });

      let closed = false;
      const timers: NodeJS.Timeout[] = [];
      const close = () => {
        if (closed) return;
        closed = true;
        for (const timer of timers) clearTimeout(timer);
        unsubscribe();
        streams.delete(close);
        response.end();
        request.log.debug({ operatorId }, 'Order stream closed');
      };
      const send = (chunk: string) => {
        response.write(chunk);
        if (response.writableLength > MAX_BUFFERED_BYTES) close();
      };

      const unsubscribe = app.orderEvents.subscribe({
        onChange: (event) => {
          send(`event: ${ORDER_CHANGED_EVENT}\ndata: ${JSON.stringify(event)}\n\n`);
        },
        // События могли потеряться: закрываем поток, браузер переподключится и перезапросит данные.
        onGap: close,
      });
      // Строка data обязательна: событие без неё EventSource не доставляет, и сторож клиента
      // (apps/web/src/api/stream.ts) его не увидел бы.
      timers.push(
        setInterval(
          () => send(`event: ${STREAM_PING_EVENT}\ndata: {}\n\n`),
          STREAM_PING_INTERVAL_MS,
        ),
      );
      // Сессия проверяется при подключении. Чтобы поток не пережил её, закрываем его в момент
      // истечения токена; переподключение без действующей сессии получит 401.
      const expiresAt = request.user.exp;
      if (expiresAt !== undefined) {
        timers.push(setTimeout(close, Math.max(expiresAt * 1000 - Date.now(), 0)));
      }
      streams.set(close, operatorId);

      // Обрыв отслеживаем по ответу: у ServerResponse 'close' означает, что ответ завершён или
      // соединение оборвалось. У запроса 'close' означает лишь, что завершён сам запрос
      // (документация Node, http.IncomingMessage / http.ServerResponse).
      response.on('close', close);
      response.on('error', close);
      send(`retry: ${RECONNECT_MS}\n\n`);
      request.log.debug({ operatorId }, 'Order stream opened');
    },
  );
  done();
};
