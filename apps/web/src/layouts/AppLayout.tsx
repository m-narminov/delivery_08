import { Anchor, AppShell, Button, Group, Text, type GroupProps } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { errorMessage } from '../api/errors';
import { logout } from '../api/session';
import { useOrderStream, type StreamStatus } from '../api/stream';
import { endSession } from '../auth';
import { Logo } from '../components/Logo';

const route = getRouteApi('/app');

const PAGE_PADDING = { base: 'md', lg: 'xl' } as const;

// Состояние live-обновлений. Когда всё работает — ничего не показываем: оператору важно знать
// только, что данные на экране могут устареть. role="status" — диктор объявит смену. На широком
// экране — в шапке, на узком — строкой над содержимым: в шапке рядом с логотипом и «Выйти» места
// нет, и «Выйти» уезжал за край.
function StreamIndicator({
  status,
  onRetry,
  ...boxProps
}: { status: StreamStatus; onRetry: () => void } & GroupProps) {
  return (
    <Group gap={6} wrap="nowrap" role="status" {...boxProps}>
      {status === 'reconnecting' && (
        <Text size="xs" c="dimmed">
          Обновления: переподключение…
        </Text>
      )}
      {status === 'closed' && (
        <>
          <Text size="xs" c="dimmed">
            Обновления отключены
          </Text>
          <Button size="compact-xs" variant="subtle" onClick={onRetry}>
            Повторить
          </Button>
        </>
      )}
    </Group>
  );
}

export function AppLayout() {
  const { session } = route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Один поток live-обновлений на вкладку: пока открыт макет приложения (оператор вошёл).
  const stream = useOrderStream();

  const signOut = useMutation({
    mutationFn: logout,
    // Данные прежнего оператора не должны пережить выход (порядок шагов — в endSession).
    onSuccess: () => endSession(queryClient, () => navigate({ to: '/login', replace: true })),
    onError: (error) => {
      notifications.show({ color: 'red', title: 'Не удалось выйти', message: errorMessage(error) });
    },
  });

  return (
    // На широком экране (от lg, 1200 px) поля слева и справа шире; у шапки те же, чтобы логотип
    // стоял вровень с содержимым.
    <AppShell header={{ height: 60 }} padding={PAGE_PADDING}>
      <AppShell.Header>
        <Group h="100%" px={PAGE_PADDING} justify="space-between" wrap="nowrap">
          {/* Логотип — ссылка на список; не заголовок: главный h1 — у страницы. Anchor, а не
              голый <a>: без подчёркивания и с фирменным кольцом фокуса, как у остальных.
              Имя ссылки начинается с видимого текста логотипа (WCAG 2.5.3). */}
          <Anchor
            component={Link}
            to="/orders"
            underline="never"
            aria-label="Foodster, сервис доставки — к списку заказов"
          >
            <Logo />
          </Anchor>
          <Group gap="sm" wrap="nowrap">
            <StreamIndicator status={stream.status} onRetry={stream.retry} visibleFrom="md" />
            <Text size="sm" visibleFrom="xs" truncate>
              {session.operator.name}
            </Text>
            <Button
              variant="default"
              size="xs"
              loading={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              Выйти
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <StreamIndicator
          status={stream.status}
          onRetry={stream.retry}
          hiddenFrom="md"
          justify="flex-end"
          mb={stream.status === 'reconnecting' || stream.status === 'closed' ? 'xs' : 0}
        />
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
