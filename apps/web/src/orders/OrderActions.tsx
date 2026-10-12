import {
  CANCEL_REASON_MAX_LENGTH,
  CANCEL_REASON_MIN_LENGTH,
  courierHasCapacity,
  isActiveDelivery,
  isCourierEditable,
  isTerminal,
  MAX_ACTIVE_DELIVERIES_PER_COURIER,
  nextStatus,
  type Courier,
  type Order,
} from '@foodster/shared';
import {
  Alert,
  Button,
  Flex,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { errorMessage } from '../api/errors';
import { couriersQuery } from '../api/orders';
import { formatDateTime } from '../format';
import { describeAction, fieldError, isActionAllowed, isAlreadyDone } from './actions';
import { describeEvent, eventActorName } from './events';
import { STATUS_LABELS } from './status';
import { StatusBadge } from './StatusBadge';
import type { useOrderActions, VersionConflict } from './useOrderActions';

type Actions = ReturnType<typeof useOrderActions>;

const appRoute = getRouteApi('/app');

// Подпись курьера в списке: сколько у него активных доставок из лимита.
function courierLabel(courier: Courier): string {
  return `${courier.name} — ${courier.activeDeliveries} из ${MAX_ACTIVE_DELIVERIES_PER_COURIER}`;
}

function CourierPicker({
  order,
  etag,
  actions,
  blocked,
  couriers,
}: {
  order: Order;
  etag: string;
  actions: Actions;
  // Идёт изменение или заказ только что изменил другой оператор — выбор недоступен.
  blocked: boolean;
  couriers: ReturnType<typeof useQuery<Courier[]>>;
}) {
  const currentId = order.courier ? String(order.courier.id) : null;
  const [selected, setSelected] = useState<string | null>(currentId);
  // Выбор привязан к версии заказа. Заказ получил новую версию (наше сохранение или другое
  // действие, «Обновить», изменение другого оператора по SSE — о нём скажет плашка) — выбор
  // сбрасывается на курьера заказа. Так «Назначить» не уйдёт поверх изменения, которого
  // оператор не видел, и не будет бесконечных 412 из-за устаревшей версии.
  const [prevEtag, setPrevEtag] = useState(etag);
  if (etag !== prevEtag) {
    setPrevEtag(etag);
    setSelected(currentId);
  }

  // Лимит считается, только если заказ уже активная доставка (готов к выдаче): тогда курьер
  // без свободного места недоступен. Раньше назначить можно любого — лимит проверится при
  // переходе в «Готов к выдаче».
  const limitApplies = isActiveDelivery(order.status);
  const data = (couriers.data ?? []).map((courier) => ({
    value: String(courier.id),
    label: courierLabel(courier),
    disabled:
      limitApplies &&
      courier.id !== order.courier?.id &&
      !courierHasCapacity(courier.activeDeliveries),
  }));
  const courierId = selected === null ? null : Number(selected);
  const changed = selected !== currentId;
  const pending = actions.pendingAction?.kind === 'courier';

  return (
    <Stack gap="xs">
      <Select
        label="Курьер"
        placeholder={couriers.isPending ? 'Загрузка…' : 'Не назначен'}
        // Активные — только «Готов к выдаче» и «У курьера»: назначение на заказ, который ещё не
        // готов к выдаче, число не меняет (лимит проверят при переходе в «Готов к выдаче»).
        // Неразрывные пробелы: «(не больше 3)» не разрывается между строк.
        description={`Рядом с именем — заказы курьера «Готов к выдаче» и «У курьера» (не\u00a0больше\u00a0${MAX_ACTIVE_DELIVERIES_PER_COURIER})`}
        data={data}
        value={selected}
        onChange={setSelected}
        error={couriers.isError ? errorMessage(couriers.error) : undefined}
        searchable
        clearable
        nothingFoundMessage="Не найден"
        disabled={blocked}
        maw={420}
      />
      {changed && (
        <Group gap="xs">
          <Button
            size="xs"
            loading={pending}
            disabled={blocked && !pending}
            onClick={() => actions.run({ kind: 'courier', courierId }, etag)}
          >
            {courierId === null ? 'Снять курьера' : order.courier ? 'Сменить курьера' : 'Назначить'}
          </Button>
          <Button
            size="xs"
            variant="subtle"
            disabled={blocked}
            onClick={() => setSelected(currentId)}
          >
            Не менять
          </Button>
        </Group>
      )}
    </Stack>
  );
}

// Модалка смонтирована всегда, открывается пропом opened: так Mantine при закрытии возвращает
// фокус на кнопку, которая её открыла (при перемонтировании фокус уходил бы в никуда).
function CancelModal({
  opened,
  reason,
  onReasonChange,
  onClose,
  onConfirm,
  pending,
  error,
  onClosed,
}: {
  onClosed: () => void;
  opened: boolean;
  reason: string;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  error: Error | null;
}) {
  // Короткую причину не отправляем: подсказка у поля появляется после попытки отменить и
  // пропадает, как только длины хватает. Ошибка поля от сервера (400) — там же; остальное сверху.
  const [attempted, setAttempted] = useState(false);
  // Подсказка — только для текущего открытия: при новом открытии сбрасывается. Сброс при
  // открытии, а не в конце анимации закрытия: та приходит не всегда (без анимаций — никогда).
  const [wasOpened, setWasOpened] = useState(opened);
  if (opened !== wasOpened) {
    setWasOpened(opened);
    if (opened) setAttempted(false);
  }
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const length = reason.trim().length;
  const tooShort = length < CANCEL_REASON_MIN_LENGTH;
  const reasonError =
    (attempted && tooShort
      ? `Не короче ${CANCEL_REASON_MIN_LENGTH} символов — сейчас ${length}`
      : undefined) ?? fieldError(error, '/reason');
  return (
    // Пока запрос идёт, модалку не закрыть: иначе панель разблокировалась бы раньше ответа.
    <Modal
      opened={opened}
      onClose={() => {
        if (!pending) onClose();
      }}
      title="Отменить заказ?"
      centered
      closeOnEscape={!pending}
      closeOnClickOutside={!pending}
      closeButtonProps={{ 'aria-label': 'Закрыть', disabled: pending }}
      onExitTransitionEnd={onClosed}
    >
      <Stack gap="md">
        {/* Ошибка — здесь же: набранная причина не теряется, можно исправить и повторить. */}
        {error && !reasonError && <Alert color="red">{errorMessage(error)}</Alert>}
        <Textarea
          label="Причина"
          // Счётчик — по всему тексту, как и ограничение длины поля (maxLength); минимум — без
          // пробелов по краям, как проверяет сервер.
          description={`Не короче ${CANCEL_REASON_MIN_LENGTH} символов: что случилось и по чьей инициативе. ${reason.length} из ${CANCEL_REASON_MAX_LENGTH}`}
          required
          ref={reasonRef}
          value={reason}
          onChange={(event) => onReasonChange(event.currentTarget.value)}
          error={reasonError}
          maxLength={CANCEL_REASON_MAX_LENGTH}
          readOnly={pending}
          autosize
          minRows={3}
          maxRows={8}
          data-autofocus
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={pending}>
            Не отменять
          </Button>
          <Button
            color="red"
            loading={pending}
            onClick={() => {
              setAttempted(true);
              // Короткая причина: фокус в поле — диктор прочтёт ошибку вместе с ним (она связана
              // с полем через aria-describedby), а оператор сразу продолжит писать.
              if (tooShort) reasonRef.current?.focus();
              else onConfirm();
            }}
          >
            Отменить заказ
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// Текст модалки конфликта: кто и что сделал, что сейчас, что хотели мы и можно ли повторить.
function ConflictDetails({
  conflict,
  couriers,
  actions,
}: {
  conflict: VersionConflict;
  couriers: Courier[];
  actions: Actions;
}) {
  const { session } = appRoute.useRouteContext();
  const { problem, action } = conflict;
  const current = problem.current;
  const last = problem.lastChange;
  const courierName =
    action.kind === 'courier'
      ? couriers.find((courier) => courier.id === action.courierId)?.name
      : undefined;
  // Своё же изменение: похоже, предыдущий запрос дошёл, а ответ потерялся (обрыв сети), и
  // повтор пришёл уже со старой версией.
  const own = last?.actor?.id === session.operator.id;
  const done = current !== null && isAlreadyDone(current, action);
  const canRetry = current !== null && !done && isActionAllowed(current, action);

  return (
    <Stack gap="sm">
      {last ? (
        <Text>
          {own ? 'Вы' : eventActorName(last)} в {formatDateTime(last.createdAt)}:{' '}
          <b>{describeEvent(last)}</b>
        </Text>
      ) : (
        <Text>Заказ изменили, пока вы смотрели карточку.</Text>
      )}
      {current && (
        <Group gap="xs">
          <Text size="sm">Сейчас:</Text>
          <StatusBadge status={current.status} />
          <Text size="sm">курьер — {current.courier?.name ?? 'не назначен'}</Text>
        </Group>
      )}
      <Text size="sm" c="dimmed">
        Вы хотели {describeAction(action, courierName)}.{' '}
        {own
          ? 'Похоже, ваше предыдущее действие всё-таки выполнилось — проверьте результат.'
          : done
            ? 'Это уже сделано — повторять не нужно.'
            : canRetry
              ? 'Можно повторить это действие поверх новой версии заказа.'
              : 'Для нового состояния заказа это действие недоступно.'}
      </Text>
      {/* На узком экране кнопки столбцом во всю ширину (в строку длинная подпись переносилась
          на две строки), с sm — в строку справа. Порядок на экране совпадает с порядком в DOM
          (без reverse): фокус и экранный диктор идут так же, как видит глаз. */}
      <Flex direction={{ base: 'column', sm: 'row' }} justify="flex-end" gap="sm" mt="xs">
        <Button
          variant={canRetry && !own ? 'default' : 'filled'}
          onClick={actions.refresh}
          data-autofocus
        >
          Обновить
        </Button>
        {canRetry && !own && (
          <Button onClick={() => void actions.retry()}>Повторить поверх новой версии</Button>
        )}
      </Flex>
    </Stack>
  );
}

// Панель действий карточки: следующий статус, курьер, отмена. Только допустимое по правилам
// из shared; итог решает сервер (лимит курьера, конфликт версий).
export function OrderActions({
  order,
  etag,
  actions,
  locked = false,
}: {
  order: Order;
  etag: string | null;
  actions: Actions;
  // Заказ только что изменил другой оператор: на мгновение кнопки недоступны, чтобы клик не
  // ушёл по надписи, сменившейся прямо под курсором. Отдельно от isPending: на снятие
  // блокировки фокус не переставляется (это делается только по завершении своего запроса).
  locked?: boolean;
}) {
  const couriers = useQuery(couriersQuery);
  const blocked = actions.isPending || locked;
  // Блокировка после чужого изменения делает кнопки недоступными — фокус с них уходит на body.
  // Когда она снята, возвращаем фокус туда, где он был (если оператор за это время никуда
  // не перешёл).
  const panelRef = useRef<HTMLDivElement>(null);
  const focusedBeforeLock = useRef<HTMLElement | null>(null);
  const [prevLocked, setPrevLocked] = useState(locked);
  if (locked !== prevLocked) {
    setPrevLocked(locked);
    if (locked) {
      const active = document.activeElement;
      focusedBeforeLock.current =
        active instanceof HTMLElement && panelRef.current?.contains(active) ? active : null;
    }
  }
  useEffect(() => {
    if (locked) return;
    const target = focusedBeforeLock.current;
    focusedBeforeLock.current = null;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (target?.isConnected && lost) target.focus();
  }, [locked]);
  const hintId = useId();
  // Кнопка, которую нажали, на время запроса становится недоступной (индикатор загрузки) и
  // теряет фокус — он уходит на body, и клавиатурный пользователь начинал бы обход страницы
  // сначала. Когда запрос завершился, а фокус потерян, ставим его на заголовок панели.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusIfLost = () => {
    const active = document.activeElement;
    if (active === null || active === document.body) headingRef.current?.focus();
  };
  // После закрытия модалки её содержимое ещё в DOM до конца анимации, а убирается чуть позже —
  // проверяем фокус в следующем кадре, когда модалки уже нет.
  const focusIfLostAfterClose = () => {
    requestAnimationFrame(focusIfLost);
  };
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !actions.isPending) focusIfLost();
    wasPending.current = actions.isPending;
  }, [actions.isPending]);
  const heading = (
    // mantine-focus-auto — та же рамка фокуса, что у кнопок и полей (а не браузерная).
    <Title
      order={2}
      size="h4"
      ref={headingRef}
      tabIndex={-1}
      className="mantine-focus-auto"
      // По ширине текста: рамка фокуса обводит слово, а не всю панель.
      w="fit-content"
    >
      Действия
    </Title>
  );
  const [cancelOpened, setCancelOpened] = useState(false);
  // Версия, при которой открыли отмену: пока оператор пишет причину, карточка может обновиться
  // (SSE) — отмена уйдёт с той версией, которую он видел, и при чужом изменении получит 412.
  const [cancelEtag, setCancelEtag] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  // Последний конфликт держим и после закрытия модалки — чтобы её текст не пропадал во время
  // анимации закрытия.
  const [shownConflict, setShownConflict] = useState<VersionConflict | null>(null);
  if (actions.conflict && actions.conflict !== shownConflict) {
    setShownConflict(actions.conflict);
    // Конфликт при отмене: модалка отмены больше не нужна — решение принимается в модалке
    // конфликта, а после «Обновить» отмена может быть уже недоступна.
    if (cancelOpened) setCancelOpened(false);
  }

  if (isTerminal(order.status)) {
    return (
      <Stack gap="xs">
        {heading}
        <Text c="dimmed" size="sm">
          Заказ {STATUS_LABELS[order.status].toLowerCase()} — действий больше нет.
        </Text>
      </Stack>
    );
  }
  // ETag приходит с карточкой всегда; без него изменение API отклонит (428) — не предлагаем.
  if (etag === null) {
    return <Alert color="yellow">Не удалось определить версию заказа. Обновите страницу.</Alert>;
  }

  const next = nextStatus(order.status);
  const nextAction = next !== null && next !== 'cancelled' ? next : null;
  const nextAllowed =
    nextAction !== null && isActionAllowed(order, { kind: 'transition', to: nextAction });
  const pendingKind = actions.pendingAction?.kind;
  // Переход в «Готов к выдаче» делает заказ активной доставкой курьера — у курьера на лимите
  // сервер его отклонит (409). Предупреждаем заранее по счётчику; решает всё равно сервер.
  const courier = couriers.data?.find((item) => item.id === order.courier?.id);
  const courierFull =
    nextAction !== null &&
    isActiveDelivery(nextAction) &&
    !isActiveDelivery(order.status) &&
    courier !== undefined &&
    !courierHasCapacity(courier.activeDeliveries);
  const nextHint =
    !nextAllowed && nextAction === 'picked_up'
      ? 'Сначала назначьте курьера'
      : courierFull
        ? `У курьера уже ${courier.activeDeliveries} из ${MAX_ACTIVE_DELIVERIES_PER_COURIER} активных доставок — переход отклонят`
        : null;
  const cancelAllowed = isActionAllowed(order, { kind: 'cancel', reason: '' });

  return (
    <Stack gap="md" ref={panelRef}>
      {heading}

      {actions.error && actions.lastAction?.kind !== 'cancel' && (
        <Alert color="red" withCloseButton onClose={actions.resetError} title="Не получилось">
          {errorMessage(actions.error)}
        </Alert>
      )}

      <Group gap="sm" align="flex-start">
        {nextAction !== null && (
          <Stack gap={4}>
            <Button
              loading={pendingKind === 'transition' || actions.retrying}
              disabled={!nextAllowed || (blocked && pendingKind !== 'transition')}
              onClick={() => actions.run({ kind: 'transition', to: nextAction }, etag)}
              aria-describedby={nextHint ? hintId : undefined}
            >
              Перевести в «{STATUS_LABELS[nextAction]}»
            </Button>
            {nextHint && (
              <Text id={hintId} size="xs" c="dimmed" maw={320}>
                {nextHint}
              </Text>
            )}
          </Stack>
        )}
        {cancelAllowed && (
          <Button
            color="red"
            variant="light"
            disabled={blocked}
            onClick={() => {
              actions.resetError();
              setReason('');
              setCancelEtag(etag);
              setCancelOpened(true);
            }}
          >
            Отменить заказ
          </Button>
        )}
      </Group>

      {isCourierEditable(order.status) && (
        <CourierPicker
          order={order}
          etag={etag}
          actions={actions}
          blocked={blocked}
          couriers={couriers}
        />
      )}

      {/* Модалка открыта до ответа сервера. Успех — заказ стал отменённым, панель сменяется
          текстом «действий больше нет». Конфликт версий — модалка отмены закрывается, решение
          в модалке конфликта. */}
      <CancelModal
        opened={cancelOpened && cancelAllowed && !actions.conflict}
        reason={reason}
        onReasonChange={setReason}
        onClose={() => {
          setCancelOpened(false);
          actions.resetError();
        }}
        pending={pendingKind === 'cancel'}
        error={actions.lastAction?.kind === 'cancel' ? actions.error : null}
        onConfirm={() => actions.run({ kind: 'cancel', reason: reason.trim() }, cancelEtag ?? etag)}
        // Модалка закрылась, а вернуть фокус некуда (кнопка отмены исчезла или была недоступна,
        // когда модалка открылась) — на заголовок панели.
        onClosed={focusIfLostAfterClose}
      />
      <Modal
        opened={actions.conflict !== null}
        onClose={actions.refresh}
        title="Заказ уже изменили"
        centered
        closeButtonProps={{ 'aria-label': 'Закрыть' }}
        // Mantine вернёт фокус туда, где он был до открытия. Если там был body (модалка открылась,
        // пока нажатая кнопка была недоступна из-за запроса), — фокус на заголовок панели.
        onExitTransitionEnd={focusIfLostAfterClose}
      >
        {shownConflict && (
          <ConflictDetails
            conflict={shownConflict}
            couriers={couriers.data ?? []}
            actions={actions}
          />
        )}
      </Modal>
    </Stack>
  );
}
