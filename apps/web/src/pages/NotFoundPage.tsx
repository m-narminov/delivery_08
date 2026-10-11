import { Button, Center, Stack, Text, Title } from '@mantine/core';
import { useDocumentTitle } from '@mantine/hooks';
import { Link } from '@tanstack/react-router';
import { ORDER_PAGE_MAX_WIDTH } from '../layouts/sizes';

function NotFoundContent() {
  // Заголовок вкладки задаёт каждая страница (иначе остался бы заголовок предыдущей).
  useDocumentTitle('Страница не найдена — Foodster Ops');
  return (
    <>
      <Title order={1}>Страница не найдена</Title>
      <Text c="dimmed">Проверьте адрес или вернитесь к списку заказов.</Text>
      <Button component={Link} to="/orders">
        К заказам
      </Button>
    </>
  );
}

// Неизвестный адрес вне приложения (или до входа) — на весь экран.
export function NotFoundPage() {
  return (
    <Center mih="100vh" p="md">
      <Stack align="center" gap="sm" ta="center">
        <NotFoundContent />
      </Stack>
    </Center>
  );
}

// Внутри приложения (например, /orders/abc) — в макете: шапка с выходом остаётся на месте,
// как и у «Заказ № N не найден». Показывается на месте карточки заказа, поэтому раскладка та же:
// блок не шире ORDER_PAGE_MAX_WIDTH по центру, содержимое влево.
export function NotFoundInApp() {
  return (
    <Stack align="flex-start" gap="sm" maw={ORDER_PAGE_MAX_WIDTH} mx="auto">
      <NotFoundContent />
    </Stack>
  );
}
