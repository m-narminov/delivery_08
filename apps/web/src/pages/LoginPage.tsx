import { DEV_OPERATOR_PASSWORD } from '@foodster/shared';
import {
  Alert,
  Button,
  Center,
  Code,
  Loader,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { useDocumentTitle } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api/errors';
import { login, LOGIN_MUTATION_KEY, operatorsQuery, sessionQuery } from '../api/session';
import { Logo } from '../components/Logo';

const route = getRouteApi('/login');

export function LoginPage() {
  const { redirect } = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const operators = useQuery(operatorsQuery);
  // Заголовок вкладки задаёт каждая страница: после выхода иначе остался бы «Заказ № N».
  useDocumentTitle('Вход — Foodster Ops');
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  // Ошибки полей показываем после первой попытки отправки, а не сразу.
  const [submitted, setSubmitted] = useState(false);

  const signIn = useMutation({
    mutationKey: LOGIN_MUTATION_KEY,
    mutationFn: login,
    onSuccess: async (session) => {
      queryClient.setQueryData(sessionQuery.queryKey, session);
      // href: адрес возврата может содержать ?фильтры. replace: «Назад» не вернёт на форму входа.
      await navigate({ href: redirect ?? '/orders', replace: true });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (operatorId === null || password === '') return;
    signIn.mutate({ operatorId: Number(operatorId), password });
  };

  return (
    <Center mih="100vh" p="md">
      <Stack align="center" gap="sm" w="100%">
        <Paper
          component="form"
          onSubmit={submit}
          noValidate
          withBorder
          shadow="sm"
          p="xl"
          radius="md"
          w="100%"
          maw={420}
        >
          <Stack>
            <Logo />
            <Title order={1} size="h3">
              Вход для операторов
            </Title>
            {/* Пароль показываем только при разработке: в production-сборке ветка вырезается
                вместе со значением. На стенде пароль — секрет, его на странице нет. */}
            {import.meta.env.DEV && (
              <Text c="dimmed" size="sm">
                Локальная разработка: пароль операторов по умолчанию —{' '}
                {/* Целиком на одной строке и выделяется одним кликом: дефис иначе делит слово. */}
                <Code style={{ whiteSpace: 'nowrap', userSelect: 'all' }}>
                  {DEV_OPERATOR_PASSWORD}
                </Code>
              </Text>
            )}

            {operators.isPending && (
              <Center py="md" role="status">
                <Loader size="sm" aria-hidden />
                <VisuallyHidden>Загрузка списка операторов…</VisuallyHidden>
              </Center>
            )}
            {operators.isError && (
              <Alert color="red" title="Не удалось загрузить операторов">
                {errorMessage(operators.error)}
                <Button variant="subtle" size="xs" mt="xs" onClick={() => void operators.refetch()}>
                  Повторить
                </Button>
              </Alert>
            )}
            {operators.isSuccess && operators.data.length === 0 && (
              <Alert color="yellow">Операторов нет. Заполните базу: npm run db:seed</Alert>
            )}
            {operators.isSuccess && operators.data.length > 0 && (
              <>
                <Select
                  label="Оператор"
                  placeholder="Выберите себя"
                  data={operators.data.map((operator) => ({
                    value: String(operator.id),
                    label: operator.name,
                  }))}
                  value={operatorId}
                  onChange={setOperatorId}
                  searchable
                  // Повторный выбор того же оператора не снимает выбор (по умолчанию у Mantine
                  // снимает — и «Войти» неожиданно отвечал «Выберите оператора»).
                  allowDeselect={false}
                  required
                  nothingFoundMessage="Никого не нашли"
                  error={submitted && operatorId === null ? 'Выберите оператора' : undefined}
                />
                <PasswordInput
                  label="Пароль"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  autoComplete="current-password"
                  // Глаз в поле — показать или скрыть пароль. Подпись — для экранного диктора (по
                  // умолчанию у Mantine английская); включён ли показ, он сообщает через aria-pressed.
                  visibilityToggleButtonProps={{ 'aria-label': 'Показать пароль' }}
                  required
                  error={submitted && password === '' ? 'Введите пароль' : undefined}
                />
                {signIn.isError && (
                  <Alert color="red" role="alert">
                    {errorMessage(signIn.error)}
                  </Alert>
                )}
                <Button type="submit" loading={signIn.isPending}>
                  Войти
                </Button>
              </>
            )}
          </Stack>
        </Paper>
        {/* Стенд публичный: оговорка, чтобы его не приняли за настоящий сервис компании. */}
        <Text c="dimmed" size="xs" ta="center" maw={420}>
          Тестовое задание для Foodster. Не является официальным сервисом компании. Название и
          логотип принадлежат правообладателю.
        </Text>
      </Stack>
    </Center>
  );
}
