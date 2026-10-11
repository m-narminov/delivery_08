import { Button, Center, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';

export function NotFoundPage() {
  return (
    <Center mih="100vh" p="md">
      <Stack align="center" gap="sm">
        <Title order={1}>Страница не найдена</Title>
        <Text c="dimmed">Проверьте адрес или вернитесь к списку заказов.</Text>
        <Button component={Link} to="/orders">
          К заказам
        </Button>
      </Stack>
    </Center>
  );
}
