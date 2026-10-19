import { afterEach, expect, it, vi } from 'vitest';
import { changeTopics, getTopicCatalog } from '../topic-catalog';
import { emptyTopicCatalog, reconcileTopics, topicMaterial } from '@shared/utils/topics';
import { previewCollection, saveCollection } from '../collections';
import { exportWorkspaceBackup, executeBackupImport, previewBackupImport, parseBackup } from '../workspace-backup';
import { mockBrowser } from './mock-browser';
import { makeTab } from '@shared/utils/__tests__/fixtures';
import { readWorkspace, WORKSPACE_KEY } from '../workspace-storage';
import type { Topic } from '@shared/types/topics';

afterEach(() => vi.unstubAllGlobals());
const material = (url: string) => topicMaterial(url, url, 'source:' + url);
async function create(name: string, urls: string[]): Promise<Topic> {
  const catalog = await changeTopics({ action: 'create', name, materials: urls.map(material) });
  return catalog.topics[catalog.topics.length - 1];
}

it('reconciles collection and matching group into one stable topic; manual names survive refresh', async () => {
  mockBrowser([makeTab({ id: 1, groupId: 10, groupName: 'Research' }), makeTab({ id: 2, groupId: 10, groupName: 'Research' })]);
  await saveCollection((await previewCollection('Research')).id, false, { purpose: 'later' });
  const first = await getTopicCatalog(); expect(first.catalog.topics).toHaveLength(1);
  const topic = first.catalog.topics[0]; expect(topic.sourceKeys).toHaveLength(2);
  await changeTopics({ action: 'update', id: topic.id, revision: topic.revision, name: 'User task', focus: 'My goal' });
  const second = await getTopicCatalog();
  expect(second.catalog.topics).toHaveLength(1);
  expect(second.catalog.topics[0]).toMatchObject({ id: topic.id, name: 'User task', focus: 'My goal' });
  expect((await getTopicCatalog()).catalog.revision).toBe(second.catalog.revision);
});

it('retains deleted-topic tombstones without deleting collections or touching Chrome', async () => {
  const browser = mockBrowser([makeTab({ id: 1 })]);
  await saveCollection((await previewCollection('Research')).id, false);
  const { catalog } = await getTopicCatalog(); const topic = catalog.topics[0];
  const changed = await changeTopics({ action: 'update', id: topic.id, revision: topic.revision, deleted: true });
  expect((await getTopicCatalog()).catalog.topics.filter((item) => !item.deletedAt)).toHaveLength(0);
  expect((await readWorkspace()).collections).toHaveLength(1);
  await changeTopics({ action: 'undo', historyId: changed.history[0].id });
  expect((await getTopicCatalog()).catalog.topics[0].deletedAt).toBeUndefined();
  expect(browser.api.tabs.remove).not.toHaveBeenCalled();
});

it('merges and undoes structure without closing tabs; old source identities do not recreate merged topics', async () => {
  const browser = mockBrowser([makeTab({ id: 1 })]);
  await saveCollection((await previewCollection('A')).id, false);
  await saveCollection((await previewCollection('B')).id, false);
  const topics = (await getTopicCatalog()).catalog.topics;
  const merged = await changeTopics({ action: 'merge', ids: topics.map((topic) => topic.id), revisions: Object.fromEntries(topics.map((topic) => [topic.id, topic.revision])), name: 'Combined' });
  expect((await getTopicCatalog()).catalog.topics.filter((topic) => !topic.mergedInto)).toHaveLength(1);
  await changeTopics({ action: 'undo', historyId: merged.history[0].id });
  expect((await getTopicCatalog()).catalog.topics.filter((topic) => !topic.mergedInto)).toHaveLength(2);
  expect(browser.api.tabs.remove).not.toHaveBeenCalled();
  expect((await readWorkspace()).collections).toHaveLength(2);
});

it('excludes manually moved material from its old source and validates revisions and undo ordering', async () => {
  mockBrowser([makeTab({ id: 1 }), makeTab({ id: 2 })]);
  await saveCollection((await previewCollection('Research')).id, false);
  const topic = (await getTopicCatalog()).catalog.topics[0];
  const split = await changeTopics({ action: 'split', id: topic.id, revision: topic.revision, name: 'Subtask', materialKeys: [topic.materials[0].key] });
  expect((await getTopicCatalog()).catalog.topics.find((item) => item.id === topic.id)?.materials).toHaveLength(1);
  await expect(changeTopics({ action: 'update', id: topic.id, revision: topic.revision, name: 'Stale' })).rejects.toThrow('changed');
  const current = split.topics.find((item) => item.id === topic.id)!;
  const renamed = await changeTopics({ action: 'update', id: topic.id, revision: current.revision, name: 'Changed' });
  await expect(changeTopics({ action: 'undo', historyId: split.history[0].id })).rejects.toThrow('Undo newer');
  await changeTopics({ action: 'undo', historyId: renamed.history[1].id });
  await changeTopics({ action: 'undo', historyId: split.history[0].id });
  expect((await getTopicCatalog()).catalog.topics.find((item) => item.id === topic.id)?.materials).toHaveLength(2);
});

it('keeps chat instances separate and never remaps their saved material to arbitrary live tabs', async () => {
  mockBrowser([makeTab({ id: 1, url: 'https://chatgpt.com/' }), makeTab({ id: 2, url: 'https://chatgpt.com/' })]);
  await saveCollection((await previewCollection('Chats')).id, false);
  const topic = (await getTopicCatalog()).catalog.topics[0];
  expect(topic.materials).toHaveLength(2);
  expect(new Set(topic.materials.map((item) => item.key)).size).toBe(2);
});

it('round trips topic metadata, remaps identities and collection references and strips executable history', async () => {
  const browser = mockBrowser([makeTab({ id: 1 })]);
  await saveCollection((await previewCollection('Research')).id, false);
  const original = (await getTopicCatalog()).catalog.topics[0];
  await changeTopics({ action: 'update', id: original.id, revision: original.revision, name: 'Preserved', focus: 'Task context' });
  const json = await exportWorkspaceBackup(); const preview = await previewBackupImport(json);
  const imported = preview.topicCatalog!.topics[0];
  expect(imported.id).not.toBe(original.id); expect(imported.name).toBe('Preserved');
  expect(imported.materials[0].collectionIds).toEqual([preview.collections[0].id]);
  expect(preview.topicCatalog!.history).toEqual([]);
  await executeBackupImport(preview.id);
  expect((await readWorkspace()).topicCatalog!.topics).toHaveLength(2);
  expect(browser.api.tabs.create).not.toHaveBeenCalled();
  expect(browser.api.tabs.remove).not.toHaveBeenCalled();
});

it('rejects executable topic URLs and corrupted catalogs and preserves data on a failed write', async () => {
  const browser = mockBrowser([]); const topic = await create('Task', ['https://example.test/']);
  const json = JSON.parse(await exportWorkspaceBackup());
  json.topicCatalog.topics[0].materials[0].url = 'javascript:alert(1)';
  expect(() => parseBackup(JSON.stringify(json))).toThrow('topic URL');
  browser.api.storage.local.set.mockRejectedValueOnce(new Error('quota'));
  await expect(changeTopics({ action: 'update', id: topic.id, revision: topic.revision, name: 'Failed' })).rejects.toThrow('quota');
  expect((browser.local[WORKSPACE_KEY] as Awaited<ReturnType<typeof readWorkspace>>).topicCatalog!.topics[0].name).toBe('Task');
});

it('does not merge same-named topics with different tasks or unique sources by their label alone', () => {
  const catalog = reconcileTopics(emptyTopicCatalog(), [
    { key: 'collection:a', name: 'AI', focus: 'Research', accepted: true, materials: [material('https://a.test/')] },
    { key: 'collection:b', name: 'AI', focus: 'Build product', accepted: true, materials: [material('https://a.test/')] },
  ]);
  expect(catalog.topics).toHaveLength(2);
});

it('allows metadata edits across source refreshes but rejects competing user edits', async () => {
  const browser = mockBrowser([makeTab({ id: 1, groupId: 10, groupName: 'Research' })]);
  const topic = (await getTopicCatalog()).catalog.topics[0];
  browser.tabs.get(1)!.title = 'Updated live page title';
  await getTopicCatalog();
  const changed = await changeTopics({ action: 'update', id: topic.id, revision: topic.revision, userRevision: 0, name: 'User name' });
  expect(changed.topics[0].name).toBe('User name');
  await expect(changeTopics({ action: 'update', id: topic.id, revision: topic.revision, userRevision: 0, name: 'Conflicting name' })).rejects.toThrow('changed');
});

it('does not rewrite the catalog when Chrome storage returns object keys in a different order', async () => {
  const browser = mockBrowser([makeTab({ id: 1, groupId: 10, groupName: 'Research' })]);
  const first = await getTopicCatalog();
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, sorted(value)])) : value;
  for (const key of Object.keys(browser.local)) browser.local[key] = sorted(browser.local[key]);
  const next = await getTopicCatalog();
  expect(next.catalog.revision).toBe(first.catalog.revision);
  expect(next.catalog.topics[0].revision).toBe(first.catalog.topics[0].revision);
});
