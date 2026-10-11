import type { OrderStatus } from '@foodster/shared';
import { Badge } from '@mantine/core';
import { STATUS_COLORS, STATUS_LABELS } from './status';

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    // Названия статусов короткие — не обрезаем. У Badge подпись с overflow: hidden, и в тесной
    // таблице браузер сжимал её до «Прин…».
    <Badge
      variant="light"
      color={STATUS_COLORS[status]}
      radius="sm"
      tt="none"
      styles={{ label: { overflow: 'visible' } }}
    >
      {STATUS_LABELS[status]}
    </Badge>
  );
}
