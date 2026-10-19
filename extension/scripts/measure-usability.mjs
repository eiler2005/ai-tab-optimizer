// Isolated synthetic profiles only. Run from extension/ after pnpm build.
// Optional baseline: AITAB_BASELINE_DIST=/absolute/path/to/dist.
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const output = resolve(process.env.AITAB_MEASUREMENT_OUTPUT ?? '../docs/testing/usability-measurements.json');
const liveCount = Number(process.env.AITAB_MEASUREMENT_TABS ?? 600);
if (!Number.isInteger(liveCount) || liveCount < 120 || liveCount > 1000) throw new Error('Use 120–1000 synthetic tabs');
const screenshotDir = '/tmp/aitab-ux-measurements';
await mkdir(screenshotDir, { recursive: true });
const measurements = [];
const versions = process.env.AITAB_BASELINE_DIST ? [['before', resolve(process.env.AITAB_BASELINE_DIST)], ['after', resolve('dist')]] : [['after', resolve('dist')]];
for (const [version, extension] of versions) {
  const profile = await mkdtemp(join(tmpdir(), 'aitab-ux-measure-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 420, height: 860 }, locale: 'en-US', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    await context.route(/^https?:\/\//, async route => new URL(route.request().url()).hostname === 'aitab.test' ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic material</title><p>Isolated usability fixture</p>' }) : route.abort());
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(async count => {
      await chrome.storage.local.set({ locale: 'en', settings: { aiProvider: 'none', localServerUrl: 'http://127.0.0.1:1', serverAiProvider: 'none', fallbackAiProvider: 'none', autoSnapshotEnabled: false } });
      for (let i = 0; i < count; i++) {
        const tab = await chrome.tabs.create({ url: `http://aitab.test/load-${String(i).padStart(4, '0')}`, active: false });
        if (tab.id) {
          for (let attempt = 0; attempt < 200; attempt++) {
            const loaded = await chrome.tabs.get(tab.id);
            if (loaded.status === 'complete' && loaded.url?.includes('/load-')) break;
            if (attempt === 199) throw new Error(`Synthetic tab ${i} did not load`);
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          await chrome.tabs.discard(tab.id).catch(() => {});
        }
      }
    }, liveCount);
    const panel = await context.newPage();
    const uri = `chrome-extension://${worker.url().split('/')[2]}/src/side-panel/index.html`;
    await panel.goto(uri);
    const send = async message => {
      const response = await panel.evaluate(payload => chrome.runtime.sendMessage(payload), message);
      if (!response.success) throw new Error(response.error);
      return response.data;
    };
    const collections = Array.from({ length: 40 }, (_, index) => ({ id: `fixture-${index}`, name: `Reference topic ${index}`, focus: `Research task ${index}`, windows: [{ tabs: Array.from({ length: 25 }, (_, offset) => ({ itemId: `item-${offset}`, url: `http://aitab.test/saved-${index * 25 + offset}`, title: `Reference ${index * 25 + offset}`, note: `Saved reference needle-${index * 25 + offset}` })) }] }));
    const preview = await send({ type: 'PREVIEW_BACKUP_IMPORT', json: JSON.stringify({ format: 'aitab-backup', version: 1, collections }) });
    await send({ type: 'IMPORT_WORKSPACE_BACKUP', previewId: preview.id });
    const started = performance.now();
    await panel.reload();
    await panel.getByRole('heading', { name: 'AITab', exact: true }).waitFor();
    if (version === 'before') await panel.getByRole('button', { name: /Tabs/ }).first().click();
    const rows = version === 'after' ? panel.locator('[data-tab-id]') : panel.locator('div.group').filter({ has: panel.locator('input[type="checkbox"]') });
    await expect(rows.first()).toBeVisible({ timeout: 30000 });
    const firstUsefulMs = performance.now() - started;
    const initialRows = await rows.count();
    const input = version === 'after' ? panel.getByLabel('Find materials', { exact: true }) : panel.locator('input[type="text"]').first();
    const timings = [];
    for (const index of [17, 122, 219, 388, 499, 27, 128, 229, 390, 501, 39, liveCount - 1]) {
      const query = `load-${String(index % liveCount).padStart(4, '0')}`;
      const start = performance.now();
      await input.fill(query);
      await expect(rows).toHaveCount(1);
      await panel.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      timings.push(performance.now() - start);
    }
    await input.fill('');
    const savedStarted = performance.now();
    if (version === 'before') {
      await panel.getByRole('button', { name: /Cleanup/ }).first().click();
      await panel.getByRole('button', { name: 'Library', exact: true }).click();
      await panel.getByLabel('Search library', { exact: true }).fill('needle-999');
    } else {
      await panel.getByRole('button', { name: 'Library', exact: true }).click();
      await panel.getByLabel('Find materials', { exact: true }).fill('needle-999');
    }
    await expect(panel.getByRole('status').filter({ hasText: 'Found: 1 /' })).toBeVisible();
    const savedRetrievalMs = performance.now() - savedStarted;
    await panel.getByRole('button', { name: 'Open page', exact: true }).click();
    await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter(t => t.url === 'http://aitab.test/saved-999').length)).toBe(1);
    await panel.getByRole('button', { name: 'Focus open page', exact: true }).click();
    expect(await panel.evaluate(async () => (await chrome.tabs.query({})).filter(t => t.url === 'http://aitab.test/saved-999').length)).toBe(1);
    const layoutChecks = [];
    if (version === 'after') {
      await input.fill('');
      for (const width of [360, 420, 600]) {
        await panel.setViewportSize({ width, height: 860 });
        for (const scale of [1, 2]) {
          await panel.evaluate(scale => document.documentElement.style.fontSize = `${scale * 100}%`, scale);
          for (const view of ['Tabs', 'Topics', 'Library']) {
            await panel.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: view, exact: true }).click();
            await expect.poll(() => panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
            layoutChecks.push({ width, textScale: scale, view, horizontalOverflow: false });
          }
          await panel.screenshot({ path: `${screenshotDir}/${width}-${scale}x.png` });
        }
      }
      await panel.setViewportSize({ width: 420, height: 860 });
      await panel.evaluate(() => document.documentElement.style.fontSize = '100%');
      await panel.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'More', exact: false }).click();
      await panel.getByRole('button', { name: 'Settings', exact: true }).click();
      const language = panel.locator('select').filter({ has: panel.locator('option[value="ru"]') });
      await language.selectOption('ru');
      await panel.evaluate(() => document.documentElement.style.fontSize = '200%');
      await panel.setViewportSize({ width: 360, height: 860 });
      for (const view of ['Вкладки', 'Темы', 'Библиотека']) {
        await panel.getByRole('navigation').getByRole('button', { name: view, exact: true }).click();
        await expect.poll(() => panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        layoutChecks.push({ width: 360, textScale: 2, view, locale: 'ru', horizontalOverflow: false });
      }
      await panel.screenshot({ path: `${screenshotDir}/360-2x-ru.png` });
    }
    const sorted = [...timings].sort((a, b) => a - b);
    measurements.push({ version, syntheticLiveTabs: liveCount, savedMaterials: 1000, collections: 40, firstUsefulMs: Math.round(firstUsefulMs), initialRenderedRows: initialRows, searchInputToResultMs: timings.map(Math.round), searchP95Ms: Math.round(sorted[Math.ceil(.95 * sorted.length) - 1]), savedRetrievalMs: Math.round(savedRetrievalMs), savedNavigationClicks: version === 'before' ? 2 : 1, singlePageOpenAndFocus: true, layoutChecks });
    console.log(JSON.stringify(measurements.at(-1)));
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
}
await writeFile(output, JSON.stringify({ measuredAt: new Date().toISOString(), method: 'Sequential isolated headless Chromium profiles; real synthetic tabs discarded after creation, 1000 saved records, 12 input-to-DOM timings include Playwright overhead; no AI or human study.', measurements }, null, 2) + '\n');
console.log(`Saved ${output}; screenshots ${screenshotDir}`);
