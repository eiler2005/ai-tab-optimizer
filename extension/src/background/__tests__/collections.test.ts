import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewCollection, saveCollection, previewCollectionMerge, executeCollectionMerge, openCollection, openCollectionItem, updateCollection } from '../collections';
import { exportWorkspaceBackup, parseBackup } from '../workspace-backup';
import { mockBrowser } from './mock-browser';
import { makeTab } from '../../shared/utils/__tests__/fixtures';
import { WORKSPACE_KEY } from '../workspace-storage';
import type { WorkspaceData } from '@shared/types/workspace';

afterEach(() => vi.unstubAllGlobals());
function setup() {
  return mockBrowser([
    makeTab({ id: 1, url: 'https://a.test/', index: 0 }),
    makeTab({ id: 2, url: 'https://b.test/', index: 1, groupId: 7, groupName: 'Work', groupColor: 'blue' }),
    makeTab({ id: 3, url: 'https://c.test/', index: 2, pinned: true }),
  ]);
}

describe('saved collections', () => {
  it('persists purpose and task through backup and opens just one saved item without duplicates', async () => {
    const browser = setup();
    const saved = (await saveCollection((await previewCollection('Task')).id, false, { purpose: 'now', focus: 'React 19', reason: 'Migration', reviewAt: 1000 })).collection;
    const imported = parseBackup(await exportWorkspaceBackup()).collections[0];
    expect(imported).toMatchObject({ purpose: 'now', focus: 'React 19', reviewAt: 1000 });
    const item = saved.windows[0].tabs[1];
    expect(await openCollectionItem(saved.id, item.itemId)).toEqual({ tabId: 2, reused: true });
    expect(browser.api.tabs.create).not.toHaveBeenCalled();
    browser.tabs.delete(2);
    expect((await openCollectionItem(saved.id, item.itemId)).reused).toBe(false);
    expect(browser.api.tabs.create).toHaveBeenCalledTimes(1);
    expect((await openCollectionItem(saved.id, item.itemId)).reused).toBe(true);
    expect(browser.api.tabs.create).toHaveBeenCalledTimes(1);
    await updateCollection(saved.id, { deleted: true });
    await expect(openCollectionItem(saved.id, item.itemId)).rejects.toThrow('not found');
  });
  it('persists detached copies before closing, protects pinned tabs and is idempotent', async () => {
    const browser = setup();
    const preview = await previewCollection('Research');
    const remove = browser.api.tabs.remove.getMockImplementation()!;
    browser.api.tabs.remove.mockImplementation(async (id) => {
      const data = browser.local[WORKSPACE_KEY] as WorkspaceData;
      expect(data.collections[0].windows[0].tabs).toHaveLength(3);
      return remove(id);
    });
    const result = await saveCollection(preview.id, true);
    const saved = result.collection.windows[0].tabs;
    expect(saved[0]).not.toHaveProperty('id');
    expect(saved[0].itemId).toBeTypeOf('string');
    expect(saved[1].groupKey).toBeTypeOf('string');
    expect(result.operation?.items.map((item) => item.state)).toEqual(['done', 'done', 'skipped']);
    expect(browser.tabs.has(3)).toBe(true);
    await saveCollection(preview.id, true);
    expect(browser.api.tabs.remove).toHaveBeenCalledTimes(2);
  });
  it('never closes tabs when saving fails', async () => {
    const browser = setup();
    const preview = await previewCollection('Before close');
    browser.api.storage.local.set.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(saveCollection(preview.id, true)).rejects.toThrow('Storage');
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
  });
  it('creates a deduplicated collection while retaining sources, notes and meaningful URL variants', async () => {
    const browser = setup();
    const a = (await saveCollection((await previewCollection('A')).id, false)).collection;
    await updateCollection(a.id, { itemId: a.windows[0].tabs[0].itemId, note: 'First note' });
    browser.tabs.get(1)!.url = 'https://a.test/#/different';
    const b = (await saveCollection((await previewCollection('B')).id, false)).collection;
    await updateCollection(b.id, { itemId: b.windows[0].tabs[1].itemId, note: 'Second note' });
    const preview = await previewCollectionMerge([a.id, b.id], 'Together');
    expect(preview.inputTabs).toBe(6);
    expect(preview.duplicatesRemoved).toBe(2);
    const result = await executeCollectionMerge(preview.id);
    expect(result.windows.flatMap((window) => window.tabs)).toHaveLength(4);
    expect(result.windows.flatMap((window) => window.tabs).find((tab) => tab.url === 'https://b.test/')?.note).toBe('Second note');
    const all = browser.local[WORKSPACE_KEY] as WorkspaceData;
    expect(all.collections).toHaveLength(3);
    expect(all.collections.find((collection) => collection.id === a.id)?.windows[0].tabs[0].note).toBe('First note');
    await executeCollectionMerge(preview.id);
    expect((browser.local[WORKSPACE_KEY] as WorkspaceData).collections).toHaveLength(3);
  });
  it('combines different notes on exact copies and refuses stale source revisions', async () => {
    setup();
    const a = (await saveCollection((await previewCollection('A')).id, false)).collection;
    const b = (await saveCollection((await previewCollection('B')).id, false)).collection;
    await updateCollection(a.id, { itemId: a.windows[0].tabs[0].itemId, note: 'Alpha' });
    await updateCollection(b.id, { itemId: b.windows[0].tabs[0].itemId, note: 'Beta' });
    const merge = await previewCollectionMerge([a.id, b.id], 'Combined');
    expect(merge.windows[0].tabs[0].note).toContain('Alpha');
    expect(merge.windows[0].tabs[0].note).toContain('Beta');
    await updateCollection(a.id, { name: 'Changed' });
    await expect(executeCollectionMerge(merge.id)).rejects.toThrow('source collection changed');
  });
  it('opens missing URLs once with group metadata', async () => {
    const browser = setup();
    const saved = (await saveCollection((await previewCollection('A')).id, false)).collection;
    expect((await openCollection(saved.id)).restoredTabIds).toHaveLength(0);
    browser.tabs.clear(); browser.windows.clear(); browser.groups.clear();
    expect((await openCollection(saved.id)).restoredTabIds).toHaveLength(3);
    expect((await openCollection(saved.id)).restoredTabIds).toHaveLength(0);
    expect([...browser.groups.values()][0].title).toBe('Work');
  });
  it('uses reversible trash and requires trash before permanent deletion', async () => {
    const browser = setup();
    const saved = (await saveCollection((await previewCollection('A')).id, false)).collection;
    await expect(updateCollection(saved.id, { permanent: true })).rejects.toThrow('trash first');
    await updateCollection(saved.id, { deleted: true });
    await expect(openCollection(saved.id)).rejects.toThrow('not found');
    await updateCollection(saved.id, { deleted: false });
    expect((await openCollection(saved.id)).skippedUrls).toHaveLength(3);
    await updateCollection(saved.id, { deleted: true });
    await updateCollection(saved.id, { permanent: true });
    expect((browser.local[WORKSPACE_KEY] as WorkspaceData).collections).toHaveLength(0);
    expect(browser.tabs.size).toBe(3);
  });
});
