import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { createTheme, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/client';
import { isUnauthorized } from './api/errors';
import { LOGIN_MUTATION_KEY } from './api/session';
import { endSession } from './auth';
import { createAppRouter } from './router';

const theme = createTheme({ primaryColor: 'orange' });

// Сессия истекла посреди работы: запрос или изменение получили 401 — на вход, а после входа
// обратно на ту же страницу. Несколько одновременных 401 дают один переход.
let endingSession = false;
function onUnauthorized(error: unknown): void {
  if (!isUnauthorized(error) || endingSession) return;
  if (router.state.location.pathname === '/login') return;
  endingSession = true;
  const redirect = router.state.location.href;
  void endSession(queryClient, () =>
    router.navigate({ to: '/login', search: { redirect } }),
  ).finally(() => {
    endingSession = false;
  });
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthorized }),
  mutationCache: new MutationCache({
    // 401 при входе — неверный пароль, а не истёкшая сессия: его показывает форма.
    onError: (error, _variables, _context, mutation) => {
      if (mutation.options.mutationKey?.[0] !== LOGIN_MUTATION_KEY[0]) onUnauthorized(error);
    },
  }),
  defaultOptions: {
    queries: {
      // Ошибку клиента (4xx) повтор не исправит; сеть и 5xx повторяем дважды.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 2,
    },
  },
});

const router = createAppRouter(queryClient);

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing in index.html');

createRoot(container).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
