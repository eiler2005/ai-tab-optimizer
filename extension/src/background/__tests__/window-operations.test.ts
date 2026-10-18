import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewWindowMerge, executeWindowMerge } from '../window-operations';
import { undoTabOperation, workspaceOverview } from '../workspace-operations';
import { WORKSPACE_KEY } from '../workspace-storage';
import { mockBrowser } from './mock-browser';
import { makeTab } from '../../shared/utils/__tests__/fixtures';
import type { WorkspaceData } from '@shared/types/workspace';

afterEach(() => vi.unstubAllGlobals());
function setup() {
  return mockBrowser([
    makeTab({ id: 1, windowId: 1, pinned: true }),
    makeTab({ id: 2, windowId: 2, index: 0, pinned: true }),
    ...[3, 4].map((id) => makeTab({ id, windowId: 2, index: id - 2, groupId: 90,
      groupName: 'Research', groupColor: 'blue', groupCollapsed: true, active: id === 3 })),
  ]);
}

describe('window consolidation', () => {
  it('moves live tabs and intact groups, then undoes without creating duplicate pages', async () => {
    const browser = setup();
    const preview = await previewWindowMerge(1, [2, 3, 4]);
    const result = await executeWindowMerge(preview.id);
    expect(result.status).toBe('completed');
    expect(browser.api.tabGroups.move).toHaveBeenCalledWith(90, { windowId: 1, index: -1 });
    expect(browser.tabs.size).toBe(4);
    expect([...browser.tabs.values()].every((tab) => tab.windowId === 1)).toBe(true);
    expect(browser.tabs.get(2)?.pinned).toBe(true);
    expect(browser.groups.get(90)?.color).toBe('blue');
    expect(browser.windows.has(2)).toBe(false);
    const undone = await undoTabOperation(result.id);
    expect(undone.status).toBe('undone');
    expect(browser.tabs.size).toBe(4);
    const sourceWindow = browser.tabs.get(2)!.windowId;
    expect(sourceWindow).not.toBe(1);
    expect(browser.tabs.get(3)?.windowId).toBe(sourceWindow);
    expect(browser.tabs.get(3)?.groupId).toBe(browser.tabs.get(4)?.groupId);
    expect(browser.groups.get(browser.tabs.get(3)!.groupId)?.title).toBe('Research');
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
    expect(browser.api.tabs.create).not.toHaveBeenCalled();
    await undoTabOperation(result.id);
    expect(browser.api.windows.create).toHaveBeenCalledTimes(1);
  });
  it('moves a selected subset without moving its unselected group members', async () => {
    const browser = setup();
    const preview = await previewWindowMerge(1, [3]);
    expect((await executeWindowMerge(preview.id)).status).toBe('completed');
    expect(browser.tabs.get(3)?.windowId).toBe(1);
    expect(browser.tabs.get(4)?.windowId).toBe(2);
    expect(browser.api.tabGroups.move).not.toHaveBeenCalled();
    expect(browser.groups.get(browser.tabs.get(3)!.groupId)?.collapsed).toBe(true);
  });
  it('skips stale previews and reports partial move errors', async () => {
    const browser = setup();
    const preview = await previewWindowMerge(1, [2, 3, 4]);
    browser.tabs.get(2)!.url = 'https://changed.test/';
    browser.api.tabGroups.move.mockRejectedValueOnce(new Error('User dragging group'));
    const operation = await executeWindowMerge(preview.id);
    expect(operation.status).toBe('partial');
    expect(operation.items.map((item) => item.state)).toEqual(['skipped', 'failed', 'failed']);
    expect(browser.tabs.size).toBe(4);
  });
  it('reconciles a moved tab after worker interruption and rejects old browser IDs', async () => {
    const browser = setup();
    const preview = await previewWindowMerge(1, [2]);
    const result = await executeWindowMerge(preview.id);
    const saved = browser.local[WORKSPACE_KEY] as WorkspaceData;
    saved.operations[0].status = 'running'; saved.operations[0].items[0].state = 'applying';
    expect((await workspaceOverview()).operations[0].items[0].state).toBe('done');
    browser.session['aitab.browser-session'] = 'another-browser-session';
    await expect(undoTabOperation(result.id)).rejects.toThrow('earlier browser session');
  });
  it('does not repeat a merge or move tabs after a journal write failure', async () => {
    const browser = setup();
    const preview = await previewWindowMerge(1, [2]);
    await executeWindowMerge(preview.id);
    await executeWindowMerge(preview.id);
    expect(browser.api.tabs.move).toHaveBeenCalledTimes(1);
    const next = await previewWindowMerge(1, [3]);
    browser.api.storage.local.set.mockRejectedValueOnce(new Error('Disk quota'));
    await expect(executeWindowMerge(next.id)).rejects.toThrow('quota');
    expect(browser.tabs.get(3)?.windowId).toBe(2);
  });
});
