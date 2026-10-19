import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

test('Continue resumes at the next page beyond the first hundred after closing the current page', async ({ panel, worker }) => {
  const ids = await worker.evaluate(async () => {
    const ids: number[] = [];
    for (let index = 0; index < 125; index++) ids.push((await chrome.tabs.create({ url: `http://aitab.test/position-${index}`, active: false })).id!);
    return ids;
  });
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url?.includes('/position-')).length)).toBe(125);
  await panel.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Review tabs', exact: true }).click();
  await panel.getByRole('button', { name: 'Compare locally without AI', exact: true }).click();
  await panel.getByRole('button', { name: 'Show more', exact: true }).click();
  await panel.getByLabel(`Include in optimization ${ids[110]}`, { exact: true }).check();
  await panel.getByRole('button', { name: 'Apply plan (1)', exact: true }).click();
  await expect(panel.getByTestId('optimization-outcome')).toContainText('position-110');
  await panel.getByRole('button', { name: 'Continue cleanup', exact: true }).click();
  await expect(panel.getByTestId('optimization-outcome')).not.toBeAttached();
  const next = panel.locator(`[data-cleanup-tab-id="${ids[111]}"]`);
  await expect(next).toHaveAttribute('data-resumed', 'true');
  await expect(next).toBeInViewport();
  await expect(next.getByRole('checkbox')).toBeFocused();
  await expect(next.getByRole('checkbox')).not.toBeChecked();
  await expect(panel.locator(`[data-cleanup-tab-id="${ids[110]}"]`)).not.toBeAttached();
});

test('single save-and-close shows its destination and continuing creates a fresh plan for the remaining tabs', async ({ panel, worker }) => {
  const ids = await worker.evaluate(async () => {
    const ids: number[] = [];
    for (const name of ['first', 'second', 'third']) ids.push((await chrome.tabs.create({ url: `http://aitab.test/continue-${name}`, active: false })).id!);
    return ids;
  });
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url?.includes('/continue-')).length)).toBe(3);
  await panel.getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Review tabs', exact: true }).click();
  await panel.getByRole('button', { name: 'Compare locally without AI', exact: true }).click();
  await panel.getByLabel(`Include in optimization ${ids[0]}`, { exact: true }).check();
  await panel.getByRole('button', { name: 'Apply plan (1)', exact: true }).click();
  const outcome = panel.getByTestId('optimization-outcome');
  await expect(outcome).toContainText('Closed: 1 · Skipped: 0 · Failed: 0');
  await expect(outcome).toContainText('Saved in collection:');
  await expect(outcome).toContainText('http://aitab.test/continue-first');
  await expect(panel.getByLabel(`Include in optimization ${ids[0]}`, { exact: true })).not.toBeAttached();
  await panel.getByRole('button', { name: 'Find saved page', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(panel.getByLabel('Find materials', { exact: true })).toHaveValue('http://aitab.test/continue-first');
  await expect(panel.getByRole('button', { name: 'Open page', exact: true })).toBeVisible();
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url === 'http://aitab.test/continue-first').length)).toBe(0);
  await panel.getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Review tabs', exact: true }).click();
  await panel.getByRole('button', { name: 'Continue cleanup', exact: true }).click();
  await expect(outcome).not.toBeAttached();
  await expect(panel.getByLabel(`Include in optimization ${ids[0]}`, { exact: true })).not.toBeAttached();
  await panel.getByLabel(`Include in optimization ${ids[1]}`, { exact: true }).check();
  await panel.getByRole('button', { name: 'Apply plan (1)', exact: true }).click();
  await expect(outcome).toContainText('http://aitab.test/continue-second');
  await panel.getByRole('button', { name: 'Undo optimization', exact: true }).click();
  await expect(panel.getByTestId('optimization-execution')).toContainText('Undo completed');
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url === 'http://aitab.test/continue-first').length)).toBe(0);
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url === 'http://aitab.test/continue-second').length)).toBe(1);
});

test('Apply shows live progress and the final save-and-close outcome in the footer while scrolled', async ({ panel, worker }, testInfo) => {
  await worker.evaluate(async () => {
    for (const name of ['apply-copy', 'apply-copy', 'apply-unique-a', 'apply-unique-b', 'apply-unique-c']) await chrome.tabs.create({ url: `http://aitab.test/${name}`, active: false });
  });
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url?.startsWith('http://aitab.test/apply-')).length)).toBe(5);
  await panel.getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Review tabs', exact: true }).click();
  await panel.getByRole('button', { name: 'Compare locally without AI', exact: true }).click();
  await panel.getByRole('button', { name: 'Select candidates in this section', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Apply plan (4)', exact: true })).toBeEnabled();
  await panel.getByTestId('workspace-view').evaluate(element => element.scrollTop = element.scrollHeight);
  await worker.evaluate(() => {
    const remove = chrome.tabs.remove.bind(chrome.tabs);
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    (globalThis as unknown as { releaseApply: () => void }).releaseApply = release;
    chrome.tabs.remove = (async (ids: number | number[]) => { await gate; await remove(ids); }) as typeof chrome.tabs.remove;
  });
  await panel.getByRole('button', { name: 'Apply plan (4)', exact: true }).click();
  await expect(panel.getByTestId('optimization-execution')).toContainText('Saving and closing…');
  await expect(panel.getByTestId('optimization-execution')).toContainText('Processed: 0 / 4');
  await expect(panel.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled();
  await worker.evaluate(() => (globalThis as unknown as { releaseApply: () => void }).releaseApply());
  await expect(panel.getByTestId('optimization-execution')).toContainText('Tabs closed: 4');
  await expect(panel.getByTestId('optimization-outcome')).toContainText('Closed: 4 · Skipped: 0 · Failed: 0');
  await expect(panel.locator('[data-closed-tab-id]')).toHaveCount(4);
  await expect(panel.getByText('Saved and closed', { exact: true })).toHaveCount(3);
  await expect(panel.getByRole('button', { name: 'Continue cleanup', exact: true })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Plan already processed', exact: true })).not.toBeAttached();
  const undo = panel.getByRole('button', { name: 'Undo optimization', exact: true });
  await expect(undo).toBeInViewport();
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url?.startsWith('http://aitab.test/apply-')).length)).toBe(1);
  const savedCount = await panel.evaluate(async () => {
    const workspace = (await chrome.storage.local.get('aitab.workspace.v1'))['aitab.workspace.v1'];
    return workspace.collections.flatMap((collection: { windows: { tabs: unknown[] }[] }) => collection.windows.flatMap(window => window.tabs)).length;
  });
  expect(savedCount).toBe(3);
  await panel.screenshot({ path: testInfo.outputPath('apply-result-footer.png') });
  await undo.click();
  await expect(panel.getByTestId('optimization-execution')).toContainText('Undo completed');
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url?.startsWith('http://aitab.test/apply-')).length)).toBe(5);
});

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
  await panel.getByRole('button', { name: 'Continue cleanup', exact: true }).click();
  const nav = panel.getByRole('navigation', { name: 'Cleanup section' });
  await nav.getByRole('button', { name: 'Duplicates', exact: true }).click();
  await panel.getByTestId('review-setup').locator('summary').first().click();
  await panel.getByRole('button', { name: 'Compare locally without AI', exact: true }).click();
  await expect(panel.getByText(/Chats sharing an address — manual review/)).toBeVisible();
  const chats = await panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'https://chatgpt.com/').map((tab) => tab.id!));
  for (const id of chats) await expect(panel.getByLabel(`Include in optimization ${id}`, { exact: true })).not.toBeAttached();
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
  await panel.getByRole('button', { name: 'Compare locally without AI', exact: true }).click();
  const checkbox = panel.getByRole('checkbox', { name: /^Include in optimization / }).filter({ visible: true });
  const enabled = await checkbox.evaluateAll((items) => items.filter((item) => !(item as HTMLInputElement).disabled).length);
  expect(enabled).toBeGreaterThan(0);
  await expect(panel.getByRole('button', { name: 'Apply plan (1)', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Cancel review', exact: true }).click();
  await expect(panel.getByTestId('review-progress')).toContainText('Review cancelled');
  release();
  await nav.getByRole('button', { name: 'Similar content', exact: true }).click();
  await panel.getByTestId('review-setup').locator('summary').first().click();
  await expect(panel.getByRole('button', { name: 'AI: review content and relevance', exact: true })).toBeEnabled();
});
