import { AppShell, Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { errorMessage } from '../api/errors';
import { logout } from '../api/session';
import { endSession } from '../auth';

const route = getRouteApi('/app');

export function AppLayout() {
  const { session } = route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const signOut = useMutation({
    mutationFn: logout,
    // Данные прежнего оператора не должны пережить выход (порядок шагов — в endSession).
    onSuccess: () => endSession(queryClient, () => navigate({ to: '/login', replace: true })),
    onError: (error) => {
      notifications.show({ color: 'red', title: 'Не удалось выйти', message: errorMessage(error) });
    },
  });

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          {/* Не заголовок: главный заголовок h1 — у страницы, шапка его не опережает. */}
          <Text component={Link} to="/orders" fw={700} size="lg" c="inherit" td="none">
            Foodster Ops
          </Text>
          <Group gap="sm" wrap="nowrap">
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
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
