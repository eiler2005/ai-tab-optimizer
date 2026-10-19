import { test, expect, request } from './fixtures';
import type { CollectionPreview, SavedCollection, WorkspaceData } from '../src/shared/types/workspace';
import type { TopicAdviceJob } from '../src/shared/types/topic-review';

test('topic comparison merges unique material without closing tabs, preserves notes, undoes and splits membership', async ({ panel, worker }, testInfo) => {
  const ids = await worker.evaluate(async () => {
    const result: number[] = [];
    for (const name of ['shared', 'only-a', 'only-b']) result.push((await chrome.tabs.create({ url: 'http://aitab.test/' + name, active: false })).id!);
    return result;
  });
  await expect.poll(async () => panel.evaluate(async (ids) => (await Promise.all(ids.map((id) => chrome.tabs.get(id)))).every((tab) => tab.url?.startsWith('http://aitab.test/')), ids)).toBe(true);
  for (const [name, list, note] of [['Research A', [ids[0], ids[1]], 'Unique note A'], ['Research B', [ids[0], ids[2]], 'Unique note B']] as const) {
    const preview = await request<CollectionPreview>(panel, { type: 'PREVIEW_COLLECTION', name, tabIds: [...list] });
    const { collection } = await request<{ collection: SavedCollection }>(panel, { type: 'SAVE_COLLECTION', previewId: preview.id, closeAfter: false });
    await request(panel, { type: 'UPDATE_COLLECTION', collectionId: collection.id, change: { itemId: collection.windows[0].tabs[0].itemId, note } });
  }
  const before = await panel.evaluate(async () => (await chrome.tabs.query({})).length);
  await panel.getByRole('button', { name: 'Topics', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Research A · 2 open · 2 saved', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Check topic overlaps', exact: true }).click();
  await panel.getByRole('button', { name: 'Compare topics', exact: true }).click();
  const comparison = panel.getByTestId('topic-comparison-detail');
  await expect(comparison).toContainText('Shared materials: 1 · Only in first: 1 · Only in second: 1');
  await comparison.getByLabel('Merged topic name', { exact: true }).fill('Combined research');
  await comparison.getByRole('button', { name: 'Merge topics', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Combined research · 3 open · 3 saved', exact: true })).toBeVisible();
  const workspace = await request<WorkspaceData>(panel, { type: 'WORKSPACE_OVERVIEW' });
  expect(workspace.collections).toHaveLength(2);
  expect(workspace.collections.flatMap((collection) => collection.windows.flatMap((window) => window.tabs.map((item) => item.note)))).toEqual(expect.arrayContaining(['Unique note A', 'Unique note B']));
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(before);
  await panel.getByText('Topic change history', { exact: true }).click();
  await panel.getByRole('button', { name: 'Undo topic change', exact: true }).first().click();
  await panel.getByRole('button', { name: 'Research A · 2 open · 2 saved', exact: true }).click();
  await panel.locator(`[data-tab-id="${ids[1]}"]`).getByRole('checkbox').check();
  await panel.getByText('Name, task and membership', { exact: true }).click();
  await panel.getByLabel('Split topic name', { exact: true }).fill('Side topic');
  await panel.getByRole('button', { name: 'Split topic by selection (1)', exact: true }).click();
  await expect(panel.getByText('New topic created. Tabs remain open.', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '← All topics', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Side topic · 1 open · 1 saved', exact: true })).toBeVisible();
  expect(await panel.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(before);
  await panel.screenshot({ path: testInfo.outputPath('topic-organization.png'), fullPage: true });
});

test('topic AI comparison is scoped, cancellable across navigation and does not block local work', async ({ panel, context, worker }) => {
  for (const name of ['Task one', 'Task two']) await request(panel, { type: 'TOPIC_COMMAND', command: { action: 'create', name,
    materials: [{ key: 'http://aitab.test/shared', url: 'http://aitab.test/shared', title: 'Common reference', collectionIds: [] }] } });
  await worker.evaluate(async () => { const stored = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...stored.settings, localServerUrl: 'http://127.0.0.1:17773' } }); });
  let release = () => {}; const gate = new Promise<void>((resolve) => { release = resolve; });
  await context.route('http://127.0.0.1:17773/topic-review', async (route) => {
    const payload = route.request().postDataJSON(); expect(payload.topics).toHaveLength(2);
    expect(payload.topics.every((topic: { materials: unknown[] }) => topic.materials.length === 1)).toBe(true);
    await gate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ relation: 'related', reason: 'Common source, different tasks', commonGround: [], uniqueA: [], uniqueB: [], suggestedName: '', evidence: [] }) }).catch(() => {});
  });
  await panel.getByRole('button', { name: 'Topics', exact: true }).click();
  await panel.getByRole('button', { name: 'Check topic overlaps', exact: true }).click();
  await panel.getByRole('button', { name: 'Compare topics', exact: true }).click();
  await panel.getByRole('button', { name: 'AI: explain topic overlap', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Stop topic comparison', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Tabs', exact: true }).click();
  await panel.getByLabel('Find materials', { exact: true }).fill('anything');
  await panel.getByRole('button', { name: 'Stop topic comparison', exact: true }).click();
  await expect.poll(async () => (await request<TopicAdviceJob>(panel, { type: 'GET_TOPIC_PAIR_REVIEW' })).status).toBe('cancelled');
  release();
});
