import {
  ORDER_CHANGED_EVENT,
  orderChangedEventSchema,
  STREAM_PING_EVENT,
  STREAM_PING_INTERVAL_MS,
  type OrderChangedEvent,
} from '@foodster/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ordersKeys } from './orders';
import { sessionQuery } from './session';

// Состояние потока live-обновлений:
// - connecting — первое подключение;
// - open — события приходят;
// - reconnecting — связь оборвалась, браузер переподключается сам (через retry из потока);
// - closed — сервер ответил не потоком (лимит вкладок, перегрузка, API недоступен — прокси
//   отвечает 502); переподключаемся сами с растущей паузой, оператор может нажать «Повторить».
export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

// События, пришедшие за это время, обрабатываются одной пачкой: пять изменений подряд — один
// перезапрос списка, а не пять.
const BATCH_MS = 300;
// Паузы между самостоятельными попытками после отказа сервера: 3, 6, 12… но не больше минуты.
const RETRY_BASE_MS = 3_000;
const RETRY_MAX_MS = 60_000;
// Сторож: сервер шлёт ping каждые 25 с. Если по открытому потоку ничего не пришло дольше двух
// с половиной интервалов, соединение «полумёртвое» (сеть пропала без разрыва TCP — браузер
// этого не замечает и не переподключается): переподключаемся сами.
const STALE_AFTER_MS = STREAM_PING_INTERVAL_MS * 2.5;
const WATCHDOG_TICK_MS = 5_000;

type Listener = (change: OrderChangedEvent) => void;
const listeners = new Set<Listener>();

// Подписка на изменения заказов из потока: карточка показывает «заказ только что изменили».
export function subscribeToOrderChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Пометить данные устаревшими. Во вкладке, которую не видно, — без перезапроса: TanStack Query
// перезапросит устаревшее, когда вкладку снова откроют (refetchOnWindowFocus). Иначе каждое
// событие гоняло бы запросы во всех открытых вкладках оператора.
function invalidate(queryClient: QueryClient, queryKey: readonly unknown[]) {
  void queryClient.invalidateQueries({
    queryKey,
    refetchType: document.hidden ? 'none' : 'active',
  });
}

// Один поток на вкладку (подключается в макете приложения). Событие «заказ изменился» помечает
// устаревшими список, карточку и историю этого заказа и счётчики курьеров — TanStack Query
// перезапросит то, что сейчас на экране.
export function useOrderStream() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>('connecting');
  // Номер попытки: новый поток после отказа сервера — по таймеру или по «Повторить».
  const [attempt, setAttempt] = useState(0);
  // Сколько отказов подряд — для растущей паузы. Ref, а не состояние: от него зависит только
  // пауза, перерисовка и новый поток не нужны.
  const failures = useRef(0);

  useEffect(() => {
    const source = new EventSource('/api/stream');
    // Эффект уже закрыт (новая попытка, выход): поздние ответы проверки сессии не должны
    // планировать повтор — он оборвал бы уже открытый новый поток.
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let batchTimer: ReturnType<typeof setTimeout> | undefined;
    const changedOrders = new Set<number>();
    let lastMessageAt = Date.now();
    const touch = () => {
      lastMessageAt = Date.now();
    };
    const watchdog = setInterval(() => {
      if (source.readyState !== EventSource.OPEN) return;
      if (Date.now() - lastMessageAt <= STALE_AFTER_MS) return;
      setStatus('reconnecting');
      setAttempt((value) => value + 1);
    }, WATCHDOG_TICK_MS);
    source.addEventListener(STREAM_PING_EVENT, touch);

    // Истории событий у сервера нет: всё, что случилось, пока потока не было (до первого
    // подключения или во время обрыва), могло пройти мимо. Поэтому при каждом подключении
    // перезапрашиваем все данные заказов.
    source.onopen = () => {
      touch();
      setStatus('open');
      failures.current = 0;
      // Запрос первой загрузки, ещё не вернувшийся, мог прочитать данные до подписки, а
      // invalidate такой запрос без данных не перезапускает — отдаёт уже идущий. Поэтому такие
      // запросы (только без данных) отменяем и запрашиваем заново. Запросы с данными не трогаем:
      // invalidate сам перезапустит их, а отмена с откатом вернула бы ждущим (например,
      // «Повторить» после конфликта) старые данные из кэша. Перезапрос — даже в скрытой
      // вкладке: иначе открытая в фоне вкладка (Ctrl+клик) осталась бы без данных.
      void queryClient
        .cancelQueries({
          queryKey: ordersKeys.all,
          predicate: (query) => query.state.data === undefined,
        })
        .then(() => queryClient.invalidateQueries({ queryKey: ordersKeys.all }));
    };

    const flush = () => {
      batchTimer = undefined;
      invalidate(queryClient, ordersKeys.lists);
      invalidate(queryClient, ordersKeys.couriers);
      for (const orderId of changedOrders) {
        invalidate(queryClient, ordersKeys.detail(orderId));
        invalidate(queryClient, ordersKeys.events(orderId));
      }
      changedOrders.clear();
    };

    source.addEventListener(ORDER_CHANGED_EVENT, (message: MessageEvent<string>) => {
      touch();
      let change: OrderChangedEvent;
      try {
        const parsed = orderChangedEventSchema.safeParse(JSON.parse(message.data));
        if (!parsed.success) return;
        change = parsed.data;
      } catch {
        return;
      }
      changedOrders.add(change.orderId);
      batchTimer ??= setTimeout(flush, BATCH_MS);
      for (const listener of listeners) listener(change);
    });

    source.onerror = () => {
      // CONNECTING — сервер закрыл поток (пропали события, истекла сессия, остановка) или
      // оборвалась связь: браузер переподключится сам. CLOSED — ответ был не потоком (401, 429,
      // 503, 502 от прокси, пока API перезапускается), и сам браузер больше пытаться не будет.
      if (source.readyState === EventSource.CONNECTING) {
        setStatus('reconnecting');
        return;
      }
      setStatus('closed');
      // Статус ответа EventSource не показывает — спрашиваем сессию. Её нет (истекла) —
      // перезапрашиваем заказы: они получат 401, и сработает общий переход на вход (main.tsx).
      // Сессия есть — отказ временный (лимит вкладок, API недоступен): пробуем снова позже.
      const scheduleRetry = () => {
        if (disposed) return;
        const delay = Math.min(RETRY_BASE_MS * 2 ** failures.current, RETRY_MAX_MS);
        failures.current += 1;
        retryTimer = setTimeout(() => setAttempt((value) => value + 1), delay);
      };
      void queryClient
        .fetchQuery({ ...sessionQuery, staleTime: 0 })
        .then((session) => {
          if (disposed) return;
          if (session === null) {
            void queryClient.invalidateQueries({ queryKey: ordersKeys.all });
            return;
          }
          scheduleRetry();
        })
        // Сессию не удалось проверить (API недоступен — прокси отвечает 502): это не «сессии
        // нет», а та же временная недоступность — тоже пробуем позже.
        .catch(scheduleRetry);
    };

    return () => {
      disposed = true;
      source.close();
      clearTimeout(retryTimer);
      clearTimeout(batchTimer);
      clearInterval(watchdog);
    };
  }, [queryClient, attempt]);

  return {
    status,
    retry: () => {
      failures.current = 0;
      setAttempt((value) => value + 1);
    },
  };
}
