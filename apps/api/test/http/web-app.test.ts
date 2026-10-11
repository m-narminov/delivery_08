import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../app';

// API отдаёт и собранный фронт (production). Вместо настоящей сборки — временная папка
// с index.html и одним файлом сборки. Папка assets есть и выше сборки: правило «кэш на год»
// должно смотреть только на путь внутри неё.
let app: TestApp;
let close: () => Promise<void>;
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'foodster-web-'));
  const webRoot = join(tempDir, 'assets', 'dist');
  await mkdir(join(webRoot, 'assets'), { recursive: true });
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>Foodster</title>');
  await writeFile(join(webRoot, 'assets', 'index-abc123.js'), 'console.log(1)');
  const testApp = await createTestApp({ webRoot });
  app = testApp.app;
  close = testApp.close;
});

afterAll(async () => {
  await close();
  await rm(tempDir, { recursive: true, force: true });
});

const html = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

describe('раздача фронта', () => {
  it('главная — index.html, перепроверяется при каждом открытии', async () => {
    const response = await app.inject({ method: 'GET', url: '/', headers: html });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('адрес страницы фронта (/orders/26) — тоже index.html: маршрут разберёт роутер фронта', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/orders/26?status=new',
      headers: html,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>Foodster</title>');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('HEAD на адрес страницы фронта — как GET, без тела', async () => {
    const response = await app.inject({ method: 'HEAD', url: '/orders/26', headers: html });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('файл сборки с хэшем в имени — кэш на год', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it.each([
    ['отсутствующий файл, браузер ждёт не HTML', 'GET', '/missing.png', { accept: 'image/png' }],
    ['неизвестный адрес API — даже если ждут HTML', 'GET', '/api/missing', html],
    ['/api со строкой запроса', 'GET', '/api?x=1', html],
    ['не GET', 'POST', '/orders/26', html],
  ])('%s → 404 problem+json', async (_case, method, url, headers) => {
    const response = await app.inject({ method: method as 'GET' | 'POST', url, headers });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('API работает как прежде', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
  });
});
