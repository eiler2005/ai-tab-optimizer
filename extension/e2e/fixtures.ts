import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import type { MessageRequest } from '../src/shared/types/messages';

export const test = base.extend<{ extensionId: string; worker: Worker; panel: Page }>({
  context: async ({}, use, testInfo) => {
    const profile = await mkdtemp(join(tmpdir(), 'aitab-e2e-'));
    const extension = resolve('dist');
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
        viewport: { width: 420, height: 860 }, locale: 'en-US',
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
      await context.route(/^https?:\/\//, async (route) => {
        if (new URL(route.request().url()).hostname === 'aitab.test') await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>AITab test page</title><h1>Isolated test page</h1>' });
        else await route.abort();
      });
      await context.tracing.start({ screenshots: true, snapshots: true });
      await use(context);
      await context.tracing.stop(testInfo.status !== testInfo.expectedStatus ? { path: testInfo.outputPath('trace.zip') } : {});
    } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ locale: 'en', settings: { aiProvider: 'none', localServerUrl: 'http://127.0.0.1:1', serverAiProvider: 'none', fallbackAiProvider: 'none' } });
    });
    await use(worker);
  },
  extensionId: async ({ worker }, use) => { await use(worker.url().split('/')[2]); },
  panel: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/side-panel/index.html`);
    await page.getByRole('heading', { name: 'AITab', exact: true }).waitFor();
    await use(page);
  },
});

export async function request<T>(panel: Page, message: MessageRequest): Promise<T> {
  const response = await panel.evaluate(async (payload) => chrome.runtime.sendMessage(payload), message);
  if (!response.success) throw new Error(response.error);
  return response.data as T;
}

export const expect = test.expect;
