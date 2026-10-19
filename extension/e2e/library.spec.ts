import { test, expect, request } from './fixtures';
import type { CollectionPreview, SavedCollection, TabOperation, WorkspaceData } from '../src/shared/types/workspace';

test('library searches saved notes, opens one missing page and preserves task metadata', async ({ panel, worker }, testInfo) => {
  const ids = await worker.evaluate(async () => {
    const a = await chrome.tabs.create({ url: 'http://aitab.test/library-a', active: false });
    const b = await chrome.tabs.create({ url: 'http://aitab.test/library-b', active: false });
    return [a.id!, b.id!];
  });
  await expect.poll(async () => panel.evaluate(async (list) => (await Promise.all(list.map((id) => chrome.tabs.get(id)))).filter((tab) => tab.url?.startsWith('http://aitab.test/')).length, ids)).toBe(2);
  const preview = await request<CollectionPreview>(panel, { type: 'PREVIEW_COLLECTION', name: 'Migration references', tabIds: ids });
  const { collection } = await request<{ collection: SavedCollection }>(panel, { type: 'SAVE_COLLECTION', previewId: preview.id, closeAfter: false, details: { purpose: 'reference', reason: 'Release migration', focus: 'React 19', reviewAt: 1 } });
  const item = collection.windows.flatMap((window) => window.tabs).find((page) => page.url.endsWith('/library-b'))!;
  await request(panel, { type: 'UPDATE_COLLECTION', collectionId: collection.id, change: { itemId: item.itemId, note: 'Unique transaction reference' } });
  await panel.evaluate(async (id) => chrome.tabs.remove(id), ids[1]);
  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  await panel.getByLabel('Find materials', { exact: true }).fill('transaction status:reference');
  await expect(panel.getByRole('status').filter({ hasText: 'Found: 1' })).toBeVisible();
  await panel.getByRole('button', { name: 'Open page', exact: true }).click();
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/library-b').length)).toBe(1);
  await expect(panel.getByRole('button', { name: 'Focus open page', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Focus open page', exact: true }).click();
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/library-b').length)).toBe(1);
  const backup = JSON.parse(await request<string>(panel, { type: 'EXPORT_WORKSPACE_BACKUP' }));
  expect(backup.collections[0]).toMatchObject({ purpose: 'reference', focus: 'React 19', reviewAt: 1 });
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('library-search.png'), fullPage: true });
});

test('topic UI retains a working page, collapses per window and saves the remainder before closing', async ({ panel, worker }) => {
  const ids = await worker.evaluate(async () => {
    const a = await chrome.tabs.create({ url: 'http://aitab.test/topic-a', active: false });
    const b = await chrome.tabs.create({ url: 'http://aitab.test/topic-b', active: false });
    return [a.id!, b.id!];
  });
  await expect.poll(async () => panel.evaluate(async (list) => (await Promise.all(list.map((id) => chrome.tabs.get(id)))).filter((tab) => tab.url?.startsWith('http://aitab.test/')).length, ids)).toBe(2);
  const preview = await request<CollectionPreview>(panel, { type: 'PREVIEW_COLLECTION', name: 'Topic Example', tabIds: ids });
  await request(panel, { type: 'SAVE_COLLECTION', previewId: preview.id, closeAfter: false });
  await panel.getByRole('button', { name: 'Topics', exact: true }).click();
  const topic = panel.getByTestId('topics-panel');
  await topic.getByRole('button', { name: 'Topic Example · 2 open · 2 saved', exact: true }).click();
  await topic.locator(`[data-tab-id="${ids[0]}"]`).getByRole('checkbox').check();
  await topic.getByRole('button', { name: 'Keep selected working', exact: true }).click();
  await topic.getByRole('button', { name: 'Group and collapse', exact: true }).click();
  const group = await panel.evaluate(async (id) => chrome.tabGroups.get((await chrome.tabs.get(id)).groupId), ids[1]);
  expect(group.collapsed).toBe(true);
  await topic.getByRole('button', { name: 'Preview save and close', exact: true }).click();
  await panel.getByRole('button', { name: 'Save and close with Undo', exact: true }).click();
  await expect.poll(async () => panel.evaluate(async (id) => (await chrome.tabs.query({})).some((tab) => tab.id === id), ids[1])).toBe(false);
  const workspace = await request<WorkspaceData>(panel, { type: 'WORKSPACE_OVERVIEW' });
  expect(workspace.collections).toHaveLength(2);
  expect(workspace.operations[0].items).toHaveLength(1);
  const undo = await request<TabOperation>(panel, { type: 'UNDO_TAB_OPERATION', operationId: workspace.operations[0].id });
  expect(undo.status).toBe('undone');
  expect(await panel.evaluate(async (id) => Boolean(await chrome.tabs.get(id)), ids[0])).toBe(true);
});

test('URL save rules add loaded pages once and leave tabs open', async ({ panel, worker }) => {
  const id = await worker.evaluate(async () => (await chrome.tabs.create({ url: 'http://aitab.test/rule-first', active: false })).id!);
  await expect.poll(async () => panel.evaluate(async (tabId) => (await chrome.tabs.get(tabId)).url, id)).toBe('http://aitab.test/rule-first');
  const first = await request<{ collectionId: string; added: boolean }>(panel, { type: 'SAVE_PAGE_TO_COLLECTION', tabId: id });
  expect((await request<{ added: boolean }>(panel, { type: 'SAVE_PAGE_TO_COLLECTION', tabId: id })).added).toBe(false);
  await request(panel, { type: 'SAVE_URL_RULES', rules: [{ id: 'rule', hostname: 'aitab.test', collectionId: first.collectionId, mode: 'save' }] });
  await panel.evaluate(async (tabId) => chrome.tabs.update(tabId, { url: 'http://aitab.test/rule-next' }), id);
  await expect.poll(async () => (await request<WorkspaceData>(panel, { type: 'WORKSPACE_OVERVIEW' })).collections[0].windows.flatMap((window) => window.tabs).length).toBe(2);
  await panel.evaluate(async (tabId) => chrome.tabs.reload(tabId), id);
  await expect.poll(async () => panel.evaluate(async (tabId) => (await chrome.tabs.get(tabId)).status, id)).toBe('complete');
  expect((await request<WorkspaceData>(panel, { type: 'WORKSPACE_OVERVIEW' })).collections[0].windows.flatMap((window) => window.tabs)).toHaveLength(2);
  expect(await panel.evaluate(async (tabId) => Boolean(await chrome.tabs.get(tabId)), id)).toBe(true);
});
