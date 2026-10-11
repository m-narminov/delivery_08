import type { QueryClient } from '@tanstack/react-query';
import { sessionQuery } from './api/session';

// Запросы, которые нужны экрану входа и переживают выход.
const KEPT_AFTER_SIGN_OUT = new Set(['session', 'operators']);

// Конец сессии — выход по кнопке или 401 посреди работы:
// 1) сессия в кэше — null: экран входа не отправит обратно в приложение;
// 2) переход на вход: страницы с данными закрываются, их запросы больше не активны;
// 3) только после этого удаляются данные прежнего оператора. Если удалить их раньше,
//    открытая страница перезапросила бы их, получила 401 и устроила бы второй переход.
export async function endSession(
  queryClient: QueryClient,
  goToLogin: () => Promise<void>,
): Promise<void> {
  queryClient.setQueryData(sessionQuery.queryKey, null);
  await goToLogin();
  queryClient.removeQueries({
    predicate: (query) => !KEPT_AFTER_SIGN_OUT.has(String(query.queryKey[0])),
  });
  queryClient.getMutationCache().clear();
}
