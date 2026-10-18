import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeRecordedTabs, previewDuplicates, executeDuplicateClose, undoTabOperation, workspaceOverview } from '../workspace-operations';
import { WORKSPACE_KEY } from '../workspace-storage';
import { mockBrowser } from './mock-browser';
import { makeTab } from '../../shared/utils/__tests__/fixtures';
import type { WorkspaceData } from '@shared/types/workspace';

afterEach(() => vi.unstubAllGlobals());
const records = () => [1, 2, 3].map((id) => makeTab({ id, url: 'https://same.test/', windowId: 1 }));

describe('offline duplicate operations', () => {
  it('journals an explicit manual close while keeping automatic protection intact', async () => {
    const browser = mockBrowser(records());
    browser.tabs.get(2)!.pinned = true;
    expect((await closeRecordedTabs([2], false)).failedTabIds).toEqual([2]);
    expect((await closeRecordedTabs([2], true)).closedTabIds).toEqual([2]);
    const workspace = await workspaceOverview();
    await undoTabOperation(workspace.operations[workspace.operations.length - 1].id);
    expect([...browser.tabs.values()].some((tab) => tab.pinned && tab.url === 'https://same.test/')).toBe(true);
  });
  it('refuses a stale AI cleanup URL and preserves tabs on journal failure', async () => {
    const browser = mockBrowser(records());
    await expect(closeRecordedTabs([2], false, 'https://old.test/')).rejects.toThrow('navigated');
    browser.api.storage.local.set.mockRejectedValueOnce(new Error('Storage failure'));
    await expect(closeRecordedTabs([2], true)).rejects.toThrow('Storage');
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
  });
  it('persists a journal before closing and makes retries idempotent', async () => {
    const browser = mockBrowser(records());
    const remove = browser.api.tabs.remove.getMockImplementation()!;
    browser.api.tabs.remove.mockImplementation(async (id) => {
      const saved = browser.local[WORKSPACE_KEY] as WorkspaceData;
      expect(saved.operations[0].items.find((item) => item.tab.id === id)?.state).toBe('applying');
      return remove(id);
    });
    const preview = await previewDuplicates();
    const decision = [{ tabId: 2, keepTabId: 1 }];
    expect((await executeDuplicateClose(preview.id, decision)).status).toBe('completed');
    await executeDuplicateClose(preview.id, decision);
    expect(browser.api.tabs.remove).toHaveBeenCalledTimes(1);
    expect(browser.tabs.has(1)).toBe(true);
  });
  it('revalidates changed URLs and missing survivors', async () => {
    const browser = mockBrowser(records());
    const preview = await previewDuplicates();
    browser.tabs.get(2)!.url = 'https://different.test/';
    const result = await executeDuplicateClose(preview.id, [{ tabId: 2, keepTabId: 1 }]);
    expect(result.items[0].state).toBe('skipped');
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
    const next = await previewDuplicates();
    browser.tabs.delete(1);
    const missing = await executeDuplicateClose(next.id, [{ tabId: 3, keepTabId: 1 }]);
    expect(missing.items[0].state).toBe('skipped');
  });
  it('honors protections changed after preview and refuses survivor deletion', async () => {
    const browser = mockBrowser(records());
    const preview = await previewDuplicates();
    browser.tabs.get(2)!.audible = true;
    expect((await executeDuplicateClose(preview.id, [{ tabId: 2, keepTabId: 1 }])).items[0].state).toBe('skipped');
    const next = await previewDuplicates();
    await expect(executeDuplicateClose(next.id, [{ tabId: 1, keepTabId: 3 }, { tabId: 3, keepTabId: 1 }])).rejects.toThrow('surviving copy');
    expect(browser.tabs.size).toBe(3);
  });
  it('reports partial failures and undoes only completed closes once', async () => {
    const browser = mockBrowser(records());
    browser.api.tabs.remove.mockRejectedValueOnce(new Error('User is dragging'));
    const preview = await previewDuplicates();
    const result = await executeDuplicateClose(preview.id, [{ tabId: 2, keepTabId: 1 }, { tabId: 3, keepTabId: 1 }]);
    expect(result.items.map((item) => item.state)).toEqual(['failed', 'done']);
    expect(result.status).toBe('partial');
    const undone = await undoTabOperation(result.id);
    expect(undone.items.map((item) => item.state)).toEqual(['failed', 'undone']);
    expect(browser.tabs.size).toBe(3);
    await undoTabOperation(result.id);
    expect(browser.api.tabs.create).toHaveBeenCalledTimes(1);
  });
  it('does not close anything when durable storage fails', async () => {
    const browser = mockBrowser(records());
    const preview = await previewDuplicates();
    browser.api.storage.local.set.mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(executeDuplicateClose(preview.id, [{ tabId: 2, keepTabId: 1 }])).rejects.toThrow('Quota');
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
  });
  it('recovers an interrupted close after a worker restart without repeating effects', async () => {
    const browser = mockBrowser(records());
    const preview = await previewDuplicates();
    const operation = await executeDuplicateClose(preview.id, [{ tabId: 2, keepTabId: 1 }]);
    const workspace = browser.local[WORKSPACE_KEY] as WorkspaceData;
    workspace.operations[0].status = 'running';
    workspace.operations[0].items[0].state = 'applying';
    const recovered = await workspaceOverview();
    expect(recovered.operations[0].status).toBe('interrupted');
    expect(recovered.operations[0].items[0].state).toBe('done');
    await undoTabOperation(operation.id);
    expect(browser.tabs.size).toBe(3);
  });
  it('never trusts old browser tab IDs after a full browser restart', async () => {
    const browser = mockBrowser(records());
    const preview = await previewDuplicates();
    await executeDuplicateClose(preview.id, [{ tabId: 2, keepTabId: 1 }]);
    const workspace = browser.local[WORKSPACE_KEY] as WorkspaceData;
    workspace.operations[0].status = 'running'; workspace.operations[0].items[0].state = 'applying';
    browser.session['aitab.browser-session'] = 'new-session';
    const recovered = await workspaceOverview();
    expect(recovered.operations[0].items[0].state).toBe('uncertain');
    expect(browser.api.tabs.create).not.toHaveBeenCalled();
  });
  it('separates exact copies, tracking variants, meaningful parameters and SPA routes', async () => {
    mockBrowser([
      ...records(),
      makeTab({ id: 4, url: 'https://same.test/?utm_source=x' }),
      makeTab({ id: 5, url: 'https://same.test/?ref=other' }),
      makeTab({ id: 6, url: 'https://same.test/#/other' }),
    ]);
    const preview = await previewDuplicates();
    expect(preview.groups.map((group) => [group.kind, group.tabs.length])).toEqual([['exact', 3], ['tracking', 2]]);
  });
});
