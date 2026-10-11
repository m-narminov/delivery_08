import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// В разработке фронт и API — разные процессы: Vite на 5173, API на 3000. Запросы /api Vite
// проксирует в API, поэтому браузер видит один источник: cookie сессии и SSE работают без CORS.
// В production фронт раздаёт сам API (этап 9).
const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: API_URL } },
  },
});
