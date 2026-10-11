import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';

// Фирменный цвет Foodster — #00802B (оттенок 6); принадлежит правообладателю, см. README,
// раздел «Товарные знаки».
// Остальные оттенки получены смешиванием с белым (0–5) и чёрным (7–9). Контраст по WCAG
// (для текста нужно не меньше 4,5):
// - белый текст на заливке #00802B — 5,09;
// - ссылки и текст цветом темы (c="foodsterGreen"): в светлой теме — оттенок 6 на белом, 5,09;
//   в тёмной Mantine берёт оттенок 4 — на фоне #242424 это 5,44;
// - light-вариант в тёмной теме — текст оттенком 0 на тёмно-зелёном фоне, outline — оттенок 2.
// Текст красить только c="foodsterGreen", без номера оттенка: «.4» и «.5» на белом и «.6»
// на тёмном фоне не проходят 4,5. Исключение — логотип (components/Logo.tsx): он всегда
// фирменного #00802B, а логотипы WCAG от требований к контрасту освобождает.
const foodsterGreen: MantineColorsTuple = [
  '#ebf5ee',
  '#d1e8d9',
  '#a8d4b7',
  '#80c095',
  '#54aa71',
  '#29944d',
  '#00802b',
  '#006e25',
  '#005c1f',
  '#004a19',
];

// Шрифт контента — Onest (файлы собираются в приложение из @fontsource-variable/onest и
// раздаются нашим же сервером). «Onest Fallback» — имя из фирменного стиля; у нас оно не
// определено, браузер его пропустит и возьмёт системный шрифт, пока Onest загружается.
const CONTENT_FONT =
  "'Onest Variable', Onest, 'Onest Fallback', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export const theme = createTheme({
  fontFamily: CONTENT_FONT,
  headings: { fontFamily: CONTENT_FONT },
  colors: { foodsterGreen },
  primaryColor: 'foodsterGreen',
  // Кнопки и прочие заливки — точно фирменным цветом в обеих темах.
  primaryShade: { light: 6, dark: 6 },
});

// Приглушённый текст (c="dimmed": подсказки, подписи). Стандартный у Mantine не проходит
// WCAG 4,5: gray-6 на белом — 3,32, dark-2 на #242424 — 4,04. Свой: gray-7 на белом — 8,18,
// dark-1 на #242424 — 7,83. Остальные переменные Mantine остаются стандартными (deepMerge).
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: { '--mantine-color-dimmed': 'var(--mantine-color-gray-7)' },
  dark: { '--mantine-color-dimmed': 'var(--mantine-color-dark-1)' },
});
