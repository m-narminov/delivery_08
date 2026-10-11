import { Group, rem, Stack, Text } from '@mantine/core';

// Фирменный логотип — блок высотой 50px: слева область SVG-молнии во всю высоту блока
// (SVG как есть), справа курсивом шрифтом Inter надпись FOODSTER (26px, 900, межбуквенный
// интервал 0,65px), под ней «сервис доставки» (13px, 500). Надписи — отдельные блоки
// в колонке (Stack), поэтому экранный диктор читает их раздельно.
// Надписи — фирменным #00802B в обеих темах: логотип по WCAG не обязан проходить требования
// контраста (исключение для логотипов, 1.4.3).
// Логотип и название Foodster принадлежат правообладателю, использованы для демонстрации
// в тестовом задании; лицензия проекта (AGPL-3.0-only) на них не распространяется
// (README, «Товарные знаки»).
const LOGO_FONT = "'Inter Variable', Inter, 'Inter Fallback', sans-serif";
const NAME_SIZE = 26;
const TAGLINE_SIZE = 13;
// Высота блока и молнии. В rem, как и текст: при увеличенном шрифте в браузере логотип
// растёт целиком, пропорции не ломаются.
const BLOCK_HEIGHT = 50;

export function Logo() {
  return (
    <Group gap={8} wrap="nowrap" align="center" h={BLOCK_HEIGHT}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 90 150"
        style={{ height: rem(BLOCK_HEIGHT), width: rem((BLOCK_HEIGHT * 90) / 150), flexShrink: 0 }}
        fill="#084A1E"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M76 12H45a30 30 0 0 0-30 25L5 83h21l-10 51 51-77H34l2-10a11 11 0 0 1 12-10h23Z"
          fill="#00822B"
        />
        <path
          d="M74 14H45a28 28 0 0 0-28 23L7 81h21l-8 43 43-65H32l2-12a13 13 0 0 1 12-12h24Z"
          fill="#FFF"
        />
        <path d="m76 12 9 6-5 25-9-6Z" fill="#0A5C26" />
        <path d="M71 37H46a11 11 0 0 0-10 9l-2 11h9l2-10a5 5 0 0 1 5-4h30Z" fill="#063817" />
        <path d="m36 46-2 11h9Z" fill="#0A5C26" />
        <path d="m67 57 9 6-51 77-9-6ZM5 83l9 6h11l1-6Z" fill="#063817" />
      </svg>
      <Stack gap={2}>
        {/* Регистр — через CSS: в разметке слово «Foodster», а не аббревиатура из заглавных. */}
        <Text
          component="span"
          ff={LOGO_FONT}
          fz={NAME_SIZE}
          fw={900}
          lts={0.65}
          fs="italic"
          tt="uppercase"
          lh={1}
          c="foodsterGreen.6"
        >
          Foodster
        </Text>
        <Text
          component="span"
          ff={LOGO_FONT}
          fz={TAGLINE_SIZE}
          fw={500}
          fs="italic"
          lh={1}
          c="foodsterGreen.6"
        >
          сервис доставки
        </Text>
      </Stack>
    </Group>
  );
}
