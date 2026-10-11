import { Stack, Text, Title } from '@mantine/core';

// Каркас: таблица заказов с фильтрами, поиском и пагинацией — следующий шаг (8b).
export function OrdersPage() {
  return (
    <Stack>
      <Title order={1} size="h2">
        Заказы
      </Title>
      <Text c="dimmed">Список заказов появится на следующем шаге.</Text>
    </Stack>
  );
}
