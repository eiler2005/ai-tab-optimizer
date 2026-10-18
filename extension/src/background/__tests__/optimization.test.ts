import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewOptimization, executeOptimization } from '../optimization';
import { undoTabOperation } from '../workspace-operations';
import { makeTab } from '../../shared/utils/__tests__/fixtures';
import { mockBrowser } from './mock-browser';

afterEach(() => vi.unstubAllGlobals());
const seed = () => [1, 2, 3].map((id) => makeTab({ id, url: 'https://same.test/', windowId: 1 }));

describe('optimization execution and reports', () => {
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
    expect(operation.optimizationReport).toEqual({ tabsBefore: 3, tabsAfter: 2, requested: 2, closed: 1, skipped: 1, failed: 0 });
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
