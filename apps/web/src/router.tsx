import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import { sessionQuery } from './api/session';
import { NotFoundPage } from './pages/NotFoundPage';
import { RouteError, RoutePending } from './pages/RouteStates';

export interface RouterContext {
  queryClient: QueryClient;
}

// Переходы в beforeLoad: redirect({ throw: true }) бросает переход сам. Объект перехода — не Error
// (это Response), а бросать не-Error запрещает ESLint (only-throw-error).
const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

// Адрес возврата после входа — только путь внутри приложения: «//evil.example», «/\evil.example»
// (браузер читает \ как /) или полный URL превратили бы форму входа в открытый редирект на
// чужой сайт.
const internalPath = z
  .string()
  .regex(/^\/(?![/\\])/)
  .optional()
  .catch(undefined);

// Сессия для beforeLoad: из кэша, а если её там нет — запросом /api/auth/me.
function loadSession(queryClient: QueryClient) {
  return queryClient.query({ ...sessionQuery, staleTime: 'static' });
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: z.object({ redirect: internalPath }),
  // Уже вошёл — на экран входа незачем. Если API недоступен, форму всё равно показываем:
  // она сама покажет ошибку загрузки операторов и даст повторить.
  beforeLoad: async ({ context, search }) => {
    const session = await loadSession(context.queryClient).catch(() => null);
    // href, а не to: адрес возврата может содержать ?фильтры, а to — только путь.
    if (session) redirect({ href: search.redirect ?? '/orders', throw: true });
  },
  // Страницы загружаются отдельными чанками: экрану входа не нужен код списка заказов.
  component: lazyRouteComponent(() => import('./pages/LoginPage'), 'LoginPage'),
});

// Всё, что под этим маршрутом, требует сессии (как группа protected-routes на бэкенде).
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    const session = await loadSession(context.queryClient);
    if (!session) {
      redirect({ to: '/login', search: { redirect: location.href }, throw: true });
      // Сюда выполнение не доходит; строка нужна TypeScript, чтобы ниже session была не null.
      throw new Error('redirect({ throw: true }) did not throw');
    }
    return { session };
  },
  component: lazyRouteComponent(() => import('./layouts/AppLayout'), 'AppLayout'),
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    redirect({ to: '/orders', throw: true });
  },
});

const ordersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/orders',
  component: lazyRouteComponent(() => import('./pages/OrdersPage'), 'OrdersPage'),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([indexRoute, ordersRoute]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPendingComponent: RoutePending,
    defaultErrorComponent: RouteError,
    // Данные свежие держит TanStack Query; роутер не кэширует результат beforeLoad сверх этого.
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
}

// Регистрация типа роутера: Link, navigate и useSearch знают все пути и параметры.
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
