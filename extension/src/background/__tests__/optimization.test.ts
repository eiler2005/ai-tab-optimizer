import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewOptimization, executeOptimization } from '../optimization';
import { undoTabOperation } from '../workspace-operations';
import { makeTab } from '../../shared/utils/__tests__/fixtures';
import { mockBrowser } from './mock-browser';
import { previewCollection, saveCollection, updateCollection } from '../collections';

afterEach(() => vi.unstubAllGlobals());
const seed = () => [1, 2, 3].map((id) => makeTab({ id, url: 'https://same.test/', windowId: 1 }));

describe('optimization execution and reports', () => {
  it('offers archived pages manually, validates saved revisions and reports archive separately', async () => {
    const browser = mockBrowser([makeTab({ id: 1, url: 'https://a.test/' }), makeTab({ id: 2, url: 'https://b.test/' })]);
    const saved = (await saveCollection((await previewCollection('Later')).id, false, { purpose: 'later' })).collection;
    const plan = await previewOptimization();
    expect(plan.candidates.map((item) => [item.category, item.recommended])).toEqual([['saved', false], ['saved', false]]);
    await updateCollection(saved.id, { purpose: 'now' });
    await expect(executeOptimization(plan.id, [2])).rejects.toThrow('collection changed');
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
    expect((await previewOptimization()).candidates).toHaveLength(0);
    await updateCollection(saved.id, { purpose: 'reference' });
    const next = await previewOptimization();
    const operation = await executeOptimization(next.id, [2]);
    expect(operation.optimizationReport).toMatchObject({ closed: 1, archived: 1, duplicatesClosed: 0, outdatedClosed: 0 });
    await undoTabOperation(operation.id);
    expect(browser.api.tabs.create).toHaveBeenCalledTimes(1);
  });
  it('keeps chats and protected pages out of the plan', async () => {
    mockBrowser([...seed(), ...[4, 5].map((id) => makeTab({ id, url: 'https://chatgpt.com/', windowId: 1 }))]);
    const plan = await previewOptimization();
    expect(plan.chatCount).toBe(2);
    expect(plan.candidates.map((item) => item.tab.id)).toEqual([2, 3]);
  });
  it('reports actual partial outcomes, rejects survivor deletion and restores once', async () => {
    const browser = mockBrowser(seed());
    const plan = await previewOptimization();
    await expect(executeOptimization(plan.id, [1])).rejects.toThrow('retained');
    browser.tabs.get(3)!.url = 'https://changed.test/';
    const operation = await executeOptimization(plan.id, [2, 3]);
    expect(operation.optimizationReport).toEqual({ tabsBefore: 3, tabsAfter: 2, requested: 2, closed: 1, skipped: 1, failed: 0, archived: 0, duplicatesClosed: 1, outdatedClosed: 0 });
    await executeOptimization(plan.id, [2, 3]);
    expect(browser.api.tabs.remove).toHaveBeenCalledTimes(1);
    await undoTabOperation(operation.id); await undoTabOperation(operation.id);
    expect(browser.api.tabs.create).toHaveBeenCalledTimes(1);
  });
  it('persists before effects and keeps all tabs if the journal cannot be saved', async () => {
    const browser = mockBrowser(seed()); const plan = await previewOptimization();
    browser.api.storage.local.set.mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(executeOptimization(plan.id, [2])).rejects.toThrow('Quota');
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
  });
});
