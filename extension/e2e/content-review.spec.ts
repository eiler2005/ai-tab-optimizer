import { test, expect, request } from './fixtures';
import type { WorkspaceData } from '../src/shared/types/workspace';

test('Similar content shows complementary groups with zero closures before the forecast', async ({ panel, context, worker }, testInfo) => {
  const ids: number[] = [];
  for (const name of ['author-a', 'author-b']) {
    const page = await context.newPage();
    await page.goto(`http://aitab.test/${name}`);
  }
  ids.push(...await worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => ['http://aitab.test/author-a', 'http://aitab.test/author-b'].includes(tab.url ?? '')).map(tab => tab.id!)));
  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...stored.settings, localServerUrl: 'http://127.0.0.1:17775' } });
  });
  await context.route('http://127.0.0.1:17775/workspace-review', async route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'codex_cli', similarGroups: [{ tabIds: ids, relation: 'related', confidence: .9, reason: 'Two authors discuss the same task with different methods.', uniqueValue: 'Distinct practical examples are useful in both sources.' }], outdatedTabs: [] }) }));
  await panel.bringToFront();
  await panel.getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Review tabs', exact: true }).click();
  const nav = panel.getByRole('navigation', { name: 'Cleanup section' });
  await nav.getByRole('button', { name: 'Similar content', exact: true }).click();
  await panel.getByText('Review focus and options', { exact: true }).click();
  await panel.getByLabel('Include accessible page excerpts', { exact: true }).uncheck();
  await panel.getByRole('button', { name: 'AI: review content and relevance', exact: true }).click();
  await expect(panel.getByTestId('similarity-summary')).toContainText('Similar materials: 1 groups');
  await expect(panel.getByTestId('similarity-summary')).toContainText('Complementary: 1');
  await expect(panel.getByTestId('review-setup')).not.toHaveAttribute('open', '');
  const group = panel.getByTestId('similarity-groups').locator('details').first();
  await expect(group).toHaveAttribute('open', '');
  await expect(group.getByText('Two authors discuss the same task with different methods.', { exact: true })).toBeVisible();
  const beforeForecast = await panel.evaluate(() => Boolean(document.querySelector('[data-testid="similarity-groups"]')!.compareDocumentPosition(document.querySelector('[data-testid="optimization-forecast"]')!) & Node.DOCUMENT_POSITION_FOLLOWING));
  expect(beforeForecast).toBe(true);
  await panel.getByRole('button', { name: 'Show matching groups', exact: true }).click();
  await expect(group.locator('summary')).toBeInViewport();
  await expect(panel.getByRole('button', { name: 'Apply plan (0)', exact: true })).toBeDisabled();
  for (const id of ids) expect(await panel.evaluate(async id => Boolean(await chrome.tabs.get(id)), id)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('similar-complementary.png') });
});

test('content review separates overlap and topical obsolescence, clears hidden selections and supports Undo', async ({ panel, worker, context }, testInfo) => {
  const errors: string[] = []; panel.on('pageerror', (error) => errors.push(error.message));
  await context.route('http://aitab.test/review-*', async (route) => {
    const old = route.request().url().endsWith('old');
    await route.fulfill({ contentType: 'text/html', body: `<title>${old ? 'Conference registration closed 2024' : 'React compiler release migration practical guide'}</title>` });
  });
  for (const name of ['copy-a', 'copy-b', 'old', 'replacement']) {
    const page = await context.newPage();
    await page.goto(`http://aitab.test/review-${name}`);
  }
  await panel.bringToFront();
  const ids = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const ids = ['copy-a', 'copy-b', 'old', 'replacement'].map((name) => tabs.find((tab) => tab.url === `http://aitab.test/review-${name}`)!.id!);
    await chrome.tabs.update(ids[0], { pinned: true });
    await chrome.tabs.update(ids[1], { active: true });
    const stored = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...stored.settings, localServerUrl: 'http://127.0.0.1:17771' } });
    return ids;
  });
  await panel.bringToFront();
  await expect.poll(async () => panel.evaluate(async (id) => (await chrome.tabs.get(id)).title, ids[2])).toBe('Conference registration closed 2024');
  await context.route('http://127.0.0.1:17771/workspace-review', async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.focus).toBe('Current material only; registration for 2024 is no longer needed');
    expect(payload.tabs.every((tab: { excerpt: string }) => tab.excerpt === '')).toBe(true);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'codex_cli', similarGroups: [
      { tabIds: ids.slice(0, 2), reason: 'Both pages cover the same compiler announcement; verify unique examples.', confidence: .9, relation: 'redundant' },
      { tabIds: [ids[1], ids[3]], reason: 'Another unused review group retains the second page.', confidence: .8 },
    ], outdatedTabs: [{ tabId: ids[2], reason: 'The 2024 registration has closed; a current replacement is open.', evidence: 'registration closed 2024', confidence: .95, replacementTabId: ids[3] }] }) });
  });
  await panel.getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Review tabs', exact: true }).click();
  const nav = panel.getByRole('navigation', { name: 'Cleanup section' });
  await nav.getByRole('button', { name: 'Similar content', exact: true }).click();
  await panel.getByText('Review focus and options', { exact: true }).click();
  await panel.getByLabel('Include accessible page excerpts', { exact: true }).uncheck();
  await panel.getByLabel('Current focus (optional)', { exact: true }).fill('Current material only; registration for 2024 is no longer needed');
  await panel.getByRole('button', { name: 'AI: review content and relevance', exact: true }).click();
  await expect(panel.getByTestId('optimization-forecast')).toContainText('AI: 4');
  await expect(panel.getByRole('button', { name: 'Apply plan (0)', exact: true })).toBeDisabled();
  await expect(panel.getByLabel(`Include in optimization ${ids[0]}`, { exact: true })).not.toBeAttached();
  await panel.getByLabel(`Include in optimization ${ids[1]}`, { exact: true }).check();
  await expect(panel.getByRole('button', { name: 'Apply plan (1)', exact: true })).toBeVisible();
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('similar-content.png'), fullPage: true });
  await nav.getByRole('button', { name: 'Outdated content', exact: true }).click();
  // Switching category retains the same plan and explicitly selected rows.
  await expect(panel.getByRole('button', { name: 'Apply plan (1)', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(panel.getByText('registration closed 2024', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Select candidates in this section', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply plan (1)', exact: true }).click();
  await expect(panel.getByText(/Closed: 1 · Skipped: 0 · Failed: 0/)).toBeVisible();
  const workspace = await request<WorkspaceData>(panel, { type: 'WORKSPACE_OVERVIEW' });
  expect(workspace.operations[0].items.map((item) => item.tab.id)).toEqual([ids[2]]);
  expect(workspace.operations[0].items[0].keep?.id).toBe(ids[3]);
  expect(await panel.evaluate(async (ids) => Promise.all(ids.map((id) => chrome.tabs.get(id))), [ids[0], ids[1], ids[3]])).toHaveLength(3);
  await panel.getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Journal and Undo', exact: true }).click();
  await panel.locator('details:visible').first().locator('summary').click();
  await panel.getByRole('button', { name: 'Undo completed actions', exact: true }).click();
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/review-old').length)).toBe(1);
  await worker.evaluate(async () => chrome.storage.local.set({ locale: 'ru' }));
  await panel.reload();
  await panel.getByRole('button', { name: 'Ещё', exact: false }).click();
  await panel.getByRole('button', { name: 'Разбор вкладок', exact: true }).click();
  await panel.getByRole('navigation', { name: 'Раздел очистки' }).getByRole('button', { name: 'Устарело по смыслу', exact: true }).click();
  await panel.getByText('Контекст и параметры проверки', { exact: true }).click();
  await expect(panel.getByLabel('Что сейчас актуально (необязательно)', { exact: true })).toBeVisible();
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('outdated-content-ru.png'), fullPage: true });
  expect(errors).toEqual([]);
});
