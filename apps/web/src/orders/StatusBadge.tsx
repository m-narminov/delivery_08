import type { OrderStatus } from '@foodster/shared';
import { Badge } from '@mantine/core';
import { STATUS_COLORS, STATUS_LABELS } from './status';

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="light" color={STATUS_COLORS[status]} radius="sm" tt="none">
      {STATUS_LABELS[status]}
    </Badge>
  );
}
