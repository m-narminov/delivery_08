import { Alert, Button, Center, Loader, Stack, VisuallyHidden } from '@mantine/core';
import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { errorMessage } from '../api/errors';

// Пока маршрут загружается (проверка сессии, чанк страницы, повторы при сбое).
export function RoutePending() {
  return (
    <Center mih="50vh" p="md" role="status">
      <Loader aria-hidden />
      <VisuallyHidden>Загрузка…</VisuallyHidden>
    </Center>
  );
}

// Ошибка при загрузке маршрута: API недоступен, 5xx. Вместо стандартного английского экрана
// TanStack Router — понятный текст и повтор.
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const queryReset = useQueryErrorResetBoundary();
  const retry = () => {
    queryReset.reset();
    reset();
    void router.invalidate();
  };
  return (
    <Center mih="50vh" p="md">
      <Stack maw={480} w="100%">
        <Alert color="red" title="Не удалось загрузить страницу">
          {errorMessage(error)}
        </Alert>
        <Button onClick={retry}>Повторить</Button>
      </Stack>
    </Center>
  );
}
