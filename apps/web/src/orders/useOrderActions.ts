import type { VersionConflictProblem } from '@foodster/shared';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorMessage } from '../api/errors';
import { orderQuery, ordersKeys, runOrderAction, type OrderAction } from '../api/orders';
import { isActionAllowed, versionConflictOf } from './actions';

const SUCCESS_MESSAGES: Record<OrderAction['kind'], string> = {
  transition: 'Статус изменён',
  courier: 'Курьер сохранён',
  cancel: 'Заказ отменён',
};

// Конфликт версий: что пытались сделать и что ответил сервер (актуальный заказ, кто изменил).
export interface VersionConflict {
  action: OrderAction;
  problem: VersionConflictProblem;
}

// Действия над заказом из карточки. Версия для If-Match — ETag карточки из кэша запроса.
// Без оптимистичных обновлений: при конфликте версий показать «как было бы» нечестно —
// на экране только то, что подтвердил сервер.
export function useOrderActions(orderId: number) {
  const queryClient = useQueryClient();
  const detailKey = orderQuery(orderId).queryKey;
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  // Идёт «Повторить»: заказ перечитывается перед повтором — другие действия недоступны.
  const [retrying, setRetrying] = useState(false);
  // Изменение уже запущено — проверка в момент вызова, а не по значению из рендера: два клика
  // подряд в одной задаче браузера иначе оба увидели бы «свободно» и дали бы два запроса.
  const inFlight = useRef(false);

  // Заказ изменился (у нас или у другого оператора): история, список и счётчики курьеров
  // могли устареть.
  const refreshRelated = () => {
    void queryClient.invalidateQueries({ queryKey: ordersKeys.events(orderId) });
    void queryClient.invalidateQueries({ queryKey: ordersKeys.lists });
    void queryClient.invalidateQueries({ queryKey: ordersKeys.couriers });
  };

  const mutation = useMutation({
    mutationFn: ({ action, etag }: { action: OrderAction; etag: string }) =>
      runOrderAction(orderId, action, etag),
    // По умолчанию без сети TanStack Query ставит мутацию на паузу до её появления: кнопка
    // крутилась бы бесконечно, а модалку отмены нельзя было бы закрыть. 'always' — запрос
    // уходит сразу и падает с понятной ошибкой «Нет связи с сервером».
    networkMode: 'always',
    onSuccess: async (response, { action }) => {
      // Запрос карточки, начатый раньше (перезапрос при фокусе окна, позже — событие SSE), мог
      // прочитать заказ до нашего изменения: отменяем его, иначе его ответ перезапишет свежие
      // данные и ETag откатится на шаг назад.
      await queryClient.cancelQueries({ queryKey: detailKey });
      // Ответ — заказ с новой версией и ETag: кладём в кэш без лишнего запроса. Но не откатываем:
      // если в кэше уже версия новее (успело прийти чужое изменение), оставляем её.
      queryClient.setQueryData(detailKey, (old) =>
        old && old.data.version > response.data.version ? old : response,
      );
      refreshRelated();
      notifications.show({ color: 'foodsterGreen', message: SUCCESS_MESSAGES[action.kind] });
    },
    // Колбэки опций мутации срабатывают всегда (в отличие от колбэков отдельного mutate(),
    // которые теряются после reset или размонтирования) — здесь и снимаем «идёт запрос».
    onSettled: () => {
      inFlight.current = false;
      setRetrying(false);
    },
    onError: (error, { action }) => {
      const problem = versionConflictOf(error);
      if (problem) {
        setConflict({ action, problem });
        return;
      }
      // 409 и прочее: текст ошибки покажет панель действий (mutation.error). Данные могли
      // устареть — например, у курьера уже 3 активные доставки, — перезапрашиваем.
      void queryClient.invalidateQueries({ queryKey: detailKey });
      refreshRelated();
    },
  });

  const busy = mutation.isPending || retrying;

  return {
    // Пока идёт изменение или повтор, новое не запускаем: двойной клик не даст двух запросов.
    run: (action: OrderAction, etag: string) => {
      if (inFlight.current || retrying) return;
      inFlight.current = true;
      setConflict(null);
      mutation.mutate({ action, etag });
    },
    isPending: busy,
    pendingAction: mutation.isPending ? mutation.variables.action : null,
    retrying,
    // Последнее запущенное действие (и после ответа) — чтобы показать его ошибку в нужном месте.
    lastAction: mutation.variables?.action ?? null,
    // Ошибку конфликта показывает модалка, не панель.
    error: mutation.error && !versionConflictOf(mutation.error) ? mutation.error : null,
    // Пока запрос идёт, состояние не сбрасываем: иначе панель решила бы, что ничего не идёт,
    // и пустила бы второе изменение со старой версией.
    resetError: () => {
      if (!mutation.isPending) mutation.reset();
    },
    conflict,
    // «Обновить»: закрыть модалку и загрузить актуальный заказ и историю.
    refresh: () => {
      setConflict(null);
      mutation.reset();
      void queryClient.invalidateQueries({ queryKey: detailKey });
      refreshRelated();
    },
    // «Повторить поверх новой версии» — той, что оператор видел в модалке. Сначала свежий заказ
    // с сервера (с его ETag): если с тех пор его изменили ещё раз — не применяем вслепую, а
    // просим посмотреть заново; если действие стало недопустимым — сообщаем. Иначе — то же
    // действие уже с новой версией.
    retry: async () => {
      if (!conflict || inFlight.current || retrying) return;
      const { action, problem } = conflict;
      // Занято с самого начала: пока заказ перечитывается, второй «Повторить» не пройдёт.
      inFlight.current = true;
      setConflict(null);
      mutation.reset();
      setRetrying(true);
      try {
        const fresh = await queryClient.fetchQuery({
          ...orderQuery(orderId),
          staleTime: 0,
          networkMode: 'always',
        });
        refreshRelated();
        if (problem.current && fresh.data.version !== problem.current.version) {
          notifications.show({
            color: 'yellow',
            message:
              'Пока вы читали сообщение, заказ изменили ещё раз. Проверьте данные и повторите',
          });
        } else if (!fresh.etag || !isActionAllowed(fresh.data, action)) {
          notifications.show({
            color: 'yellow',
            message: 'Для нового состояния заказа это действие уже недоступно',
          });
        } else {
          // «Идёт повтор» и «идёт запрос» снимет onSettled мутации: иначе между вызовом и
          // началом мутации кнопки на мгновение снова стали бы доступны.
          mutation.mutate({ action, etag: fresh.etag });
          return;
        }
      } catch (error) {
        notifications.show({
          color: 'red',
          title: 'Не удалось обновить заказ',
          message: errorMessage(error),
        });
      }
      inFlight.current = false;
      setRetrying(false);
    },
  };
}
