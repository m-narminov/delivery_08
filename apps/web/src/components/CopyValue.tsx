import { ActionIcon, CheckIcon, Tooltip, VisuallyHidden } from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { flushSync } from 'react-dom';

// Иконка «копировать» — две карточки; рисуем сами, чтобы не тянуть библиотеку иконок ради одной.
function CopyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

// Кнопка «скопировать значение» с подсказкой при наведении и при фокусе с клавиатуры.
// label — что именно копируется, для экранного диктора («Скопировать номер заказа 1042»); он не
// меняется. Результат («Скопировано» или «Не удалось скопировать») диктор узнаёт из отдельной
// области role="status": смену имени кнопки в фокусе разные дикторы объявляют по-разному.
// useClipboard, а не CopyButton: CopyButton ошибку наружу не отдаёт, и неудачное копирование
// (нет доступа к буферу, страница не по https) выглядело бы как успешное.
export function CopyValue({ value, label }: { value: string; label: string }) {
  const clipboard = useClipboard({ timeout: 1500 });
  const result = clipboard.error ? 'Не удалось скопировать' : clipboard.copied ? 'Скопировано' : '';
  return (
    <>
      <Tooltip
        label={result || 'Скопировать'}
        withArrow
        position="right"
        events={{ hover: true, focus: true, touch: false }}
      >
        <ActionIcon
          variant="subtle"
          color={clipboard.error ? 'red' : clipboard.copied ? 'foodsterGreen' : 'gray'}
          // 28 px: цель с запасом над минимумом 24 px (WCAG 2.5.8).
          size="md"
          onClick={() => {
            // Сначала отрисовать сброс (пустой текст в области объявлений), потом копировать:
            // если API буфера нет, ошибка выставляется синхронно, в том же обработчике, React
            // объединил бы оба обновления, текст не изменился бы — и повторную ошибку диктор
            // не объявил бы. flushSync применяет сброс к DOM сразу.
            flushSync(() => clipboard.reset());
            clipboard.copy(value);
          }}
          aria-label={label}
        >
          {clipboard.copied ? <CheckIcon size={12} /> : <CopyIcon />}
        </ActionIcon>
      </Tooltip>
      <VisuallyHidden role="status">{result}</VisuallyHidden>
    </>
  );
}
