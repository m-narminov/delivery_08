import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Окружение тестов React: с этим флагом React предупреждает об обновлениях состояния вне act().
// Testing Library ставит его сам, только когда в Vitest включены глобальные describe/it (у нас
// импорты явные), — поэтому здесь.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Без глобального afterEach Testing Library не размонтирует компоненты сама: убираем после
// каждого теста, чтобы тесты не видели DOM друг друга.
afterEach(() => {
  cleanup();
});

// Чего нет в jsdom, но что вызывает Mantine: медиа-запросы (адаптивные стили, цветовая схема),
// ResizeObserver (поля ввода, таблица), document.fonts. Заглушки достаточно: раскладку и шрифты
// jsdom не считает.
// В jsdom matchMedia нет; проверка по типу, а не по наличию свойства, — на случай, если
// другая версия jsdom объявит его без реализации.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// document.fonts: поле причины (Textarea autosize) пересчитывает высоту после загрузки шрифтов.
if (!('fonts' in document) || document.fonts === undefined) {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
}
