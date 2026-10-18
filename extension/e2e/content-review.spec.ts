import { test, expect, request } from './fixtures';
import type { WorkspaceData } from '../src/shared/types/workspace';

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
      { tabIds: ids.slice(0, 2), reason: 'Both pages cover the same compiler announcement; verify unique examples.', confidence: .9 },
      { tabIds: [ids[1], ids[3]], reason: 'Another unused review group retains the second page.', confidence: .8 },
    ], outdatedTabs: [{ tabId: ids[2], reason: 'The 2024 registration has closed; a current replacement is open.', evidence: 'registration closed 2024', confidence: .95, replacementTabId: ids[3] }] }) });
  });
  await panel.getByRole('button', { name: /Cleanup/ }).click();
  const nav = panel.getByRole('navigation', { name: 'Cleanup section' });
  await nav.getByRole('button', { name: 'Similar content', exact: true }).click();
  await panel.getByText('Review focus and options', { exact: true }).click();
  await panel.getByLabel('Include accessible page excerpts', { exact: true }).uncheck();
  await panel.getByLabel('Current focus (optional)', { exact: true }).fill('Current material only; registration for 2024 is no longer needed');
  await panel.getByRole('button', { name: 'AI: review content and relevance', exact: true }).click();
  await expect(panel.getByText('Both pages cover the same compiler announcement; verify unique examples.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: /Close selected with Undo/ })).toBeDisabled();
  await expect(panel.getByLabel(`Close candidate ${ids[0]}`, { exact: true })).toBeDisabled();
  await expect(panel.getByLabel(`Close candidate ${ids[1]}`, { exact: true }).first()).toBeEnabled();
  await panel.getByLabel(`Close candidate ${ids[1]}`, { exact: true }).first().check();
  await expect(panel.getByRole('button', { name: 'Close selected with Undo (1)', exact: true })).toBeVisible();
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await panel.getByTestId('workspace-view').evaluate((element) => { element.scrollTop = 0; });
  await panel.screenshot({ path: testInfo.outputPath('similar-content.png'), fullPage: true });
  await nav.getByRole('button', { name: 'Outdated content', exact: true }).click();
  await expect(panel.getByRole('button', { name: /Close selected with Undo/ })).toBeDisabled();
  await expect(panel.getByText('registration closed 2024', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Select candidates in this section', exact: true }).click();
  await panel.getByRole('button', { name: 'Close selected with Undo (1)', exact: true }).click();
  const workspace = await request<WorkspaceData>(panel, { type: 'WORKSPACE_OVERVIEW' });
  expect(workspace.operations[0].items.map((item) => item.tab.id)).toEqual([ids[2]]);
  expect(workspace.operations[0].items[0].keep?.id).toBe(ids[3]);
  expect(await panel.evaluate(async (ids) => Promise.all(ids.map((id) => chrome.tabs.get(id))), [ids[0], ids[1], ids[3]])).toHaveLength(3);
  await panel.locator('details').first().locator('summary').click();
  await panel.getByRole('button', { name: 'Undo completed actions', exact: true }).click();
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/review-old').length)).toBe(1);
  await worker.evaluate(async () => chrome.storage.local.set({ locale: 'ru' }));
  await panel.reload();
  await panel.getByRole('button', { name: /Очистка/ }).click();
  await panel.getByRole('navigation', { name: 'Раздел очистки' }).getByRole('button', { name: 'Устарело по смыслу', exact: true }).click();
  await panel.getByText('Контекст и параметры проверки', { exact: true }).click();
  await expect(panel.getByLabel('Что сейчас актуально (необязательно)', { exact: true })).toBeVisible();
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('outdated-content-ru.png'), fullPage: true });
  expect(errors).toEqual([]);
});
