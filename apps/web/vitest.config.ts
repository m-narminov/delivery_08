import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Тесты фронта: jsdom — браузерное окружение (DOM, события) внутри Node, без настоящего браузера.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
