import {
  Alert,
  Button,
  Center,
  Loader,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api/errors';
import { login, LOGIN_MUTATION_KEY, operatorsQuery, sessionQuery } from '../api/session';

const route = getRouteApi('/login');

export function LoginPage() {
  const { redirect } = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const operators = useQuery(operatorsQuery);
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
          <Title order={1} size="h2">
            Foodster Ops
          </Title>
          <Text c="dimmed" size="sm">
            Вход для операторов. Общий пароль демо-стенда задаётся при заполнении базы
            (SEED_OPERATOR_PASSWORD, локально — foodster-demo).
          </Text>

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
                required
                nothingFoundMessage="Никого не нашли"
                error={submitted && operatorId === null ? 'Выберите оператора' : undefined}
              />
              <PasswordInput
                label="Пароль"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                autoComplete="current-password"
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
    </Center>
  );
}
