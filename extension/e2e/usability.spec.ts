import { test, expect, request } from './fixtures';
import type { CollectionPreview } from '../src/shared/types/workspace';
import type { TopicCatalog } from '../src/shared/types/topics';

test('tabs are first; filtered selection exposes hidden choices and menus remain reachable', async ({ panel, worker }, testInfo) => {
  await worker.evaluate(async () => {
    await chrome.tabs.create({ url: 'http://aitab.test/filter-one', active: false });
    await chrome.tabs.create({ url: 'http://aitab.test/filter-two', active: false });
    await chrome.tabs.create({ url: 'http://aitab.test/other', active: false });
  });
  const navigation = panel.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation.getByRole('button').first()).toHaveText('Tabs');
  await expect(navigation.getByRole('button', { name: 'Tabs', exact: true })).toHaveAttribute('aria-current', 'page');
  await panel.getByLabel('Find materials', { exact: true }).fill('filter-');
  await expect(panel.locator('[data-tab-id]')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Select results', exact: true }).click();
  await expect(panel.getByText('Selected: 2 · Outside filter: 0', { exact: true })).toBeVisible();
  await panel.getByLabel('Find materials', { exact: true }).fill('filter-one');
  await expect(panel.getByText('Selected: 2 · Outside filter: 1', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Topics', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Topics', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Collections', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Journal and Undo', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Journal and Undo', exact: true })).toBeVisible();
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('navigation.png') });
});

test('topic names and task edits persist through reload; deleting a topic retains saved pages and can be undone', async ({ panel, worker }) => {
  const id = await worker.evaluate(async () => (await chrome.tabs.create({ url: 'http://aitab.test/topic-persist', active: false })).id!);
  await expect.poll(async () => panel.evaluate(async (id) => (await chrome.tabs.get(id)).url, id)).toBe('http://aitab.test/topic-persist');
  const preview = await request<CollectionPreview>(panel, { type: 'PREVIEW_COLLECTION', name: 'Original topic', tabIds: [id] });
  await request(panel, { type: 'SAVE_COLLECTION', previewId: preview.id, closeAfter: false });
  await panel.getByRole('button', { name: 'Topics', exact: true }).click();
  await panel.getByRole('button', { name: 'Original topic · 1 open · 1 saved', exact: true }).click();
  await panel.getByText('Name, task and membership', { exact: true }).click();
  await panel.getByLabel('Topic name', { exact: true }).fill('My current task');
  await panel.getByLabel('Topic focus', { exact: true }).fill('Keep the unique reference');
  await panel.getByRole('button', { name: 'Save topic', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'My current task', exact: true })).toBeVisible();
  await panel.reload();
  await panel.getByRole('button', { name: 'Topics', exact: true }).click();
  await panel.getByRole('button', { name: 'My current task · 1 open · 1 saved', exact: true }).click();
  await expect(panel.getByRole('paragraph').filter({ hasText: /^Keep the unique reference$/ })).toBeVisible();
  await panel.getByText('Name, task and membership', { exact: true }).click();
  await panel.getByRole('button', { name: 'Delete topic, retain materials', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'My current task', exact: true })).not.toBeVisible();
  const { catalog } = await request<{ catalog: TopicCatalog }>(panel, { type: 'GET_TOPIC_CATALOG' });
  const deletion = catalog.history[catalog.history.length - 1];
  await request(panel, { type: 'TOPIC_COMMAND', command: { action: 'undo', historyId: deletion.id } });
  await panel.getByRole('button', { name: 'Refresh topics', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'My current task · 1 open · 1 saved', exact: true })).toBeVisible();
  expect(await panel.evaluate(async (id) => Boolean(await chrome.tabs.get(id)), id)).toBe(true);
});

test('shared search finds a saved note from Tabs, opens one page and keeps comparison out of the first screen', async ({ panel, worker }) => {
  const id = await worker.evaluate(async () => (await chrome.tabs.create({ url: 'http://aitab.test/search-saved', active: false })).id!);
  await expect.poll(async () => panel.evaluate(async (id) => (await chrome.tabs.get(id)).url, id)).toBe('http://aitab.test/search-saved');
  const preview = await request<CollectionPreview>(panel, { type: 'PREVIEW_COLLECTION', name: 'Findable references', tabIds: [id] });
  const saved = await request<{ collection: { id: string; windows: { tabs: { itemId: string }[] }[] } }>(panel, { type: 'SAVE_COLLECTION', previewId: preview.id, closeAfter: false });
  await request(panel, { type: 'UPDATE_COLLECTION', collectionId: saved.collection.id, change: { itemId: saved.collection.windows[0].tabs[0].itemId, note: 'Unique concurrency explanation' } });
  await panel.evaluate(async (id) => chrome.tabs.remove(id), id);
  await panel.getByLabel('Search scope', { exact: true }).selectOption('all');
  await panel.getByLabel('Find materials', { exact: true }).fill('concurrency collection:"Findable references"');
  await expect(panel.getByRole('status').filter({ hasText: 'Found: 1' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'AI: compare library', exact: true })).not.toBeVisible();
  await panel.getByRole('button', { name: 'Open page', exact: true }).click();
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/search-saved').length)).toBe(1);
  await panel.getByRole('button', { name: 'Focus open page', exact: true }).click();
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/search-saved').length)).toBe(1);
});

test('a selected-tab review stays scoped and survives navigation while unrelated copies remain open', async ({ panel, worker }) => {
  const ids = await worker.evaluate(async () => {
    const ids: number[] = [];
    for (let index = 0; index < 3; index++) ids.push((await chrome.tabs.create({ url: 'http://aitab.test/scoped-copy', active: false })).id!);
    return ids;
  });
  await panel.getByLabel('Find materials', { exact: true }).fill('scoped-copy');
  await expect(panel.locator('[data-tab-id]')).toHaveCount(3);
  for (const id of ids.slice(0, 2)) await panel.locator(`[data-tab-id="${id}"]`).getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Review…', exact: true }).last().click();
  await panel.getByRole('button', { name: 'Compare locally without AI', exact: true }).click();
  await expect(panel.getByTestId('optimization-forecast')).toContainText('2 → 1');
  await panel.getByRole('button', { name: 'Topics', exact: true }).click();
  await expect(panel.getByTestId('workspace-actions')).not.toBeVisible();
  await panel.getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Review tabs', exact: true }).click();
  await expect(panel.getByTestId('optimization-forecast')).toContainText('2 → 1');
  await panel.getByRole('button', { name: 'Apply plan (1)', exact: true }).click();
  await expect(panel.getByText(/Closed: 1 · Skipped: 0 · Failed: 0/)).toBeVisible();
  expect(await panel.evaluate(async (id) => Boolean(await chrome.tabs.get(id)), ids[2])).toBe(true);
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/scoped-copy').length)).toBe(2);
});
