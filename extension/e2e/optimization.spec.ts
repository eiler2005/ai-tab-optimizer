import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

test('optimization keeps distinct chat state, exposes persistent actions, exports actual report and supports Undo', async ({ panel, context, worker }, testInfo) => {
  await context.route('https://chatgpt.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>ChatGPT draft</title><textarea>Different unsent state</textarea>' }));
  for (let index = 0; index < 2; index++) {
    const page = await context.newPage(); await page.goto('https://chatgpt.com/');
  }
  await worker.evaluate(async () => {
    for (let index = 0; index < 3; index++) await chrome.tabs.create({ url: 'http://aitab.test/optimize', active: false });
  });
  await panel.bringToFront();
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/optimize').length)).toBe(3);
  await panel.getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Review tabs', exact: true }).click();
  await panel.getByLabel('Include AI review in the plan', { exact: true }).uncheck();
  await panel.getByRole('button', { name: 'Optimize tabs — prepare plan', exact: true }).click();
  await expect(panel.getByTestId('optimization-forecast')).toContainText('Chats retained: 2');
  const apply = panel.getByRole('button', { name: 'Apply plan (2)', exact: true });
  await expect(apply).toBeVisible();
  await panel.getByTestId('workspace-view').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const box = await apply.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(await panel.evaluate(() => innerHeight));
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('optimization-plan.png'), fullPage: true });
  await apply.click();
  await expect(panel.getByText(/Closed: 2 · Skipped: 0 · Failed: 0/)).toBeVisible();
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'https://chatgpt.com/').length)).toBe(2);
  const download = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download report', exact: true }).click();
  const text = await readFile((await (await download).path())!, 'utf8');
  expect(text).toContain('Actual after:'); expect(text).toContain('Closed: 2');
  await panel.getByRole('button', { name: 'Undo optimization', exact: true }).click();
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/optimize').length)).toBe(3);
  const nav = panel.getByRole('navigation', { name: 'Cleanup section' });
  await nav.getByRole('button', { name: 'Duplicates', exact: true }).click();
  await panel.getByRole('button', { name: 'Find duplicates', exact: true }).click();
  await expect(panel.getByText('Chats sharing an address — manual review', { exact: true })).toBeVisible();
  const chats = await panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'https://chatgpt.com/').map((tab) => tab.id!));
  for (const id of chats) await expect(panel.getByLabel(`Close tab ${id}`, { exact: true })).not.toBeChecked();
});

test('AI progress remains visible, duplicate selection stays usable and cancellation releases review controls', async ({ panel, context, worker }) => {
  await worker.evaluate(async () => {
    for (let index = 0; index < 2; index++) await chrome.tabs.create({ url: 'http://aitab.test/progress', active: false });
    const stored = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...stored.settings, localServerUrl: 'http://127.0.0.1:17772' } });
  });
  await panel.bringToFront();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await context.route('http://127.0.0.1:17772/workspace-review', async (route) => {
    await gate;
    await route.fulfill({ contentType: 'application/json', body: '{"provider":"codex_cli","similarGroups":[],"outdatedTabs":[]}' }).catch(() => {});
  });
  await panel.getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Review tabs', exact: true }).click();
  const nav = panel.getByRole('navigation', { name: 'Cleanup section' });
  await nav.getByRole('button', { name: 'Similar content', exact: true }).click();
  await panel.getByText('Review focus and options', { exact: true }).click();
  await panel.getByLabel('Include accessible page excerpts', { exact: true }).uncheck();
  await panel.getByRole('button', { name: 'AI: review content and relevance', exact: true }).click();
  await expect(panel.getByTestId('review-progress')).toContainText('AI is comparing content');
  await nav.getByRole('button', { name: 'Duplicates', exact: true }).click();
  await panel.getByRole('button', { name: 'Find duplicates', exact: true }).click();
  const checkbox = panel.getByRole('checkbox', { name: /^Close tab / }).filter({ visible: true });
  const enabled = await checkbox.evaluateAll((items) => items.filter((item) => !(item as HTMLInputElement).disabled).length);
  expect(enabled).toBeGreaterThan(0);
  await expect(panel.getByRole('button', { name: 'Close selected copies (1)', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Cancel review', exact: true }).click();
  await expect(panel.getByTestId('review-progress')).toContainText('Review cancelled');
  release();
  await nav.getByRole('button', { name: 'Similar content', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'AI: review content and relevance', exact: true })).toBeEnabled();
});
