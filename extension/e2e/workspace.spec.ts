import { readFile } from 'node:fs/promises';
import { test, expect, request } from './fixtures';
import type { CollectionPreview, TabOperation, WindowMergePreview, WorkspaceData } from '../src/shared/types/workspace';
import type { RestoreResult } from '../src/background/session-actions';

test('real extension UI closes exact duplicates, persists history across a worker restart, and undoes once', async ({ panel, worker, context }) => {
  const errors: string[] = []; panel.on('pageerror', (error) => errors.push(error.message));
  await worker.evaluate(async () => {
    for (let i = 0; i < 3; i++) await chrome.tabs.create({ url: 'http://aitab.test/article', active: false });
  });
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/article').length)).toBe(3);
  await panel.getByRole('button', { name: /Cleanup/ }).click();
  await panel.getByRole('navigation', { name: 'Cleanup section' }).getByRole('button', { name: 'Duplicates', exact: true }).click();
  await panel.getByRole('button', { name: 'Find duplicates', exact: true }).click();
  await expect(panel.getByText('Exact duplicates', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Close selected copies (2)', exact: true }).click();
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/article').length)).toBe(1);
  const before = await request<WorkspaceData>(panel, { type: 'WORKSPACE_OVERVIEW' });
  expect(before.operations[0].status).toBe('completed');
  const cdp = await context.newCDPSession(panel);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const after = await request<WorkspaceData>(panel, { type: 'WORKSPACE_OVERVIEW' });
  expect(after.operations[0].id).toBe(before.operations[0].id);
  await panel.locator('details').first().locator('summary').click();
  await panel.getByRole('button', { name: 'Undo completed actions', exact: true }).click();
  await expect.poll(async () => panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/article').length)).toBe(3);
  const undone = await request<WorkspaceData>(panel, { type: 'WORKSPACE_OVERVIEW' });
  expect(undone.operations[0].status).toBe('undone');
  await request(panel, { type: 'UNDO_TAB_OPERATION', operationId: before.operations[0].id });
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url === 'http://aitab.test/article').length)).toBe(3);
  expect(errors).toEqual([]);
});

test('real Chrome moves intact groups and pinned tabs and undoes into a recreated source window', async ({ panel, worker }) => {
  const seed = await worker.evaluate(async () => {
    const source = await chrome.windows.create({ url: 'http://aitab.test/pinned', focused: false });
    const pinnedId = source!.tabs![0].id!;
    await chrome.tabs.update(pinnedId, { pinned: true });
    const a = await chrome.tabs.create({ windowId: source!.id!, url: 'http://aitab.test/a', active: false });
    const b = await chrome.tabs.create({ windowId: source!.id!, url: 'http://aitab.test/b', active: false });
    const groupId = await chrome.tabs.group({ tabIds: [a.id!, b.id!], createProperties: { windowId: source!.id! } });
    await chrome.tabGroups.update(groupId, { title: 'Research', color: 'blue', collapsed: true });
    return { source: source!.id!, ids: [pinnedId, a.id!, b.id!] };
  });
  await expect.poll(async () => panel.evaluate(async (ids) => (await chrome.tabs.query({})).filter((tab) => ids.includes(tab.id!) && tab.url?.startsWith('http://aitab.test/')).length, seed.ids)).toBe(3);
  const target = await panel.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
  const preview = await request<WindowMergePreview>(panel, { type: 'PREVIEW_WINDOW_MERGE', targetWindowId: target, tabIds: seed.ids });
  const operation = await request<TabOperation>(panel, { type: 'EXECUTE_WINDOW_MERGE', previewId: preview.id });
  expect(operation.status).toBe('completed');
  const moved = await panel.evaluate(async (ids) => Promise.all(ids.map((id) => chrome.tabs.get(id))), seed.ids);
  expect(moved.every((tab) => tab.windowId === target)).toBe(true);
  expect(moved[0].pinned).toBe(true);
  expect(moved[1].groupId).toBe(moved[2].groupId);
  const undo = await request<TabOperation>(panel, { type: 'UNDO_TAB_OPERATION', operationId: operation.id });
  expect(undo.status).toBe('undone');
  const restored = await panel.evaluate(async (ids) => Promise.all(ids.map((id) => chrome.tabs.get(id))), seed.ids);
  expect(restored[0].windowId).not.toBe(target);
  expect(restored.every((tab) => tab.windowId === restored[0].windowId)).toBe(true);
  expect(restored.map((tab) => tab.index)).toEqual([0, 1, 2]);
  expect(restored[0].pinned).toBe(true);
  const group = await panel.evaluate(async (id) => chrome.tabGroups.get(id), restored[1].groupId);
  expect(group.title).toBe('Research'); expect(group.color).toBe('blue'); expect(group.collapsed).toBe(true);
});

test('collection UI saves notes and round-trips a JSON backup without opening imported tabs', async ({ panel, worker }, testInfo) => {
  const seed = await worker.evaluate(async () => {
    const source = await chrome.windows.create({ url: 'http://aitab.test/save-a', focused: false });
    const b = await chrome.tabs.create({ windowId: source!.id!, url: 'http://aitab.test/save-b', active: false });
    return { windowId: source!.id!, ids: [source!.tabs![0].id!, b.id!] };
  });
  await panel.getByRole('button', { name: /Cleanup/ }).click();
  await panel.getByRole('navigation', { name: 'Cleanup section' }).getByRole('button', { name: 'Collections', exact: true }).click();
  await panel.getByLabel('Collection name', { exact: true }).fill('Research');
  await expect(panel.getByLabel('Tabs to save')).toContainText('Window');
  await panel.getByLabel('Tabs to save').selectOption(String(seed.windowId));
  await panel.getByRole('button', { name: 'Preview save', exact: true }).click();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByText('Collection saved.', { exact: true })).toBeVisible();
  await panel.locator('summary').filter({ hasText: 'Research · 2' }).click();
  await panel.locator('summary').filter({ hasText: /^Note$/ }).first().click();
  await panel.getByLabel('Note text', { exact: true }).first().fill('Keep these user notes');
  await panel.getByRole('button', { name: 'Save note', exact: true }).first().click();
  await expect(panel.getByText('Note saved.', { exact: true })).toBeVisible();
  const downloadPromise = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download JSON backup', exact: true }).click();
  const download = await downloadPromise;
  const json = await readFile((await download.path())!, 'utf8');
  expect(JSON.parse(json).collections[0].windows[0].tabs[0].note).toBe('Keep these user notes');
  const tabCount = await panel.evaluate(async () => (await chrome.tabs.query({})).length);
  await panel.getByLabel('Import backup', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await panel.getByRole('button', { name: 'Append validated data', exact: true }).click();
  const workspace = await request<WorkspaceData>(panel, { type: 'WORKSPACE_OVERVIEW' });
  expect(workspace.collections).toHaveLength(2);
  expect(workspace.collections[1].windows[0].tabs[0].note).toBe('Keep these user notes');
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(tabCount);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await panel.getByTestId('workspace-view').evaluate((element) => { element.scrollTop = 0; });
  await panel.screenshot({ path: testInfo.outputPath('collections.png'), fullPage: true });
  await worker.evaluate(async () => chrome.storage.local.set({ locale: 'ru' }));
  await panel.reload();
  await panel.getByRole('button', { name: /Очистка/ }).click();
  await panel.getByRole('navigation', { name: 'Раздел очистки' }).getByRole('button', { name: 'Коллекции', exact: true }).click();
  await expect(panel.getByText('Мои коллекции', { exact: true })).toBeVisible();
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('collections-ru.png'), fullPage: true });
});

test('grouping and collection restore keep separate windows and only open missing URLs', async ({ panel, worker }) => {
  const seed = await worker.evaluate(async () => {
    const a = await chrome.windows.create({ url: 'http://aitab.test/window-a', focused: false });
    const pinned = a!.tabs![0].id!;
    await chrome.tabs.update(pinned, { pinned: true });
    const extra = await chrome.tabs.create({ windowId: a!.id!, url: 'http://aitab.test/group-a', active: false });
    const b = await chrome.windows.create({ url: 'http://aitab.test/window-b', focused: false });
    return { ids: [pinned, extra.id!, b!.tabs![0].id!], groupIds: [extra.id!, b!.tabs![0].id!], originalWindows: [a!.id!, b!.id!] };
  });
  await expect.poll(async () => panel.evaluate(async (ids) => (await chrome.tabs.query({})).filter((tab) => ids.includes(tab.id!) && tab.url?.startsWith('http://aitab.test/')).length, seed.ids)).toBe(3);
  await request(panel, { type: 'GROUP_TABS_BY_CLUSTER', tabIds: seed.groupIds, name: 'References', color: 'blue' });
  const grouped = await panel.evaluate(async (ids) => Promise.all(ids.map((id) => chrome.tabs.get(id))), seed.groupIds);
  expect(grouped.map((tab) => tab.windowId)).toEqual(seed.originalWindows);
  const preview = await request<CollectionPreview>(panel, { type: 'PREVIEW_COLLECTION', name: 'Two windows', tabIds: seed.ids });
  const saved = await request<{ collection: { id: string } }>(panel, { type: 'SAVE_COLLECTION', previewId: preview.id, closeAfter: false });
  await panel.evaluate(async (ids) => chrome.tabs.remove(ids), seed.ids);
  const restored = await request<RestoreResult>(panel, { type: 'OPEN_COLLECTION', collectionId: saved.collection.id });
  expect(restored.failedUrls).toEqual([]); expect(restored.errors).toEqual([]);
  expect(restored.restoredTabIds).toHaveLength(3);
  // Chrome can return a created tab while its URL is still pending navigation.
  await expect.poll(async () => panel.evaluate(async (ids) => (await Promise.all(ids.map((id) => chrome.tabs.get(id)))).map((tab) => tab.url).sort(), restored.restoredTabIds))
    .toEqual(['http://aitab.test/group-a', 'http://aitab.test/window-a', 'http://aitab.test/window-b']);
  const tabs = await panel.evaluate(async (ids) => Promise.all(ids.map((id) => chrome.tabs.get(id))), restored.restoredTabIds);
  expect(new Set(tabs.map((tab) => tab.windowId)).size).toBe(2);
  expect(tabs.find((tab) => tab.url === 'http://aitab.test/window-a')?.pinned).toBe(true);
  const groupTabs = tabs.filter((tab) => tab.groupId !== -1);
  const groups = await panel.evaluate(async (ids) => Promise.all(ids.map((id) => chrome.tabGroups.get(id))), groupTabs.map((tab) => tab.groupId));
  expect(groups.every((group) => group.title === 'References' && group.color === 'blue')).toBe(true);
  expect(new Set(groups.map((group) => group.windowId)).size).toBe(2);
  const again = await request<RestoreResult>(panel, { type: 'OPEN_COLLECTION', collectionId: saved.collection.id });
  expect(again.restoredTabIds).toHaveLength(0); expect(again.skippedUrls).toHaveLength(3);
});
