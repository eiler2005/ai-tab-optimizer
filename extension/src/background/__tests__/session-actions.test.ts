import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreWindows } from '../session-actions';
import type { WindowSnapshot } from '@shared/types/snapshot';

afterEach(() => vi.unstubAllGlobals());

function setup(existing: string[] = []) {
  let id = 100;
  const api = {
    tabs: {
      query: vi.fn(async () => existing.map((url) => ({ url }))),
      create: vi.fn(async () => ({ id: ++id })),
      update: vi.fn(async () => ({})),
      group: vi.fn(async () => 500),
    },
    windows: {
      create: vi.fn(async () => ({ id: ++id, tabs: [{ id: ++id }] })),
      update: vi.fn(async () => ({})),
    },
    tabGroups: { update: vi.fn(async () => ({})) },
  };
  vi.stubGlobal('chrome', api);
  return api;
}

const windows: WindowSnapshot[] = [
  { windowId: 1, focused: true, tabs: [
    { url: 'https://a.test/', title: 'A', domain: 'a.test', pinned: true, active: true },
    { url: 'https://b.test/', title: 'B', domain: 'b.test', pinned: false,
      groupId: 7, groupName: 'Research', groupColor: 'blue', groupCollapsed: true },
  ] },
  { windowId: 2, focused: false, tabs: [
    { url: 'https://c.test/', title: 'C', domain: 'c.test', pinned: false },
  ] },
];

describe('session restore', () => {
  it('restores separate windows, pinning, focus and group metadata', async () => {
    const api = setup();
    const result = await restoreWindows(windows);
    expect(result.restoredTabIds).toHaveLength(3);
    expect(api.windows.create).toHaveBeenCalledTimes(2);
    expect(api.tabs.update).toHaveBeenCalledWith(102, { pinned: true });
    expect(api.tabGroups.update).toHaveBeenCalledWith(500, { title: 'Research', color: 'blue', collapsed: true });
    expect(api.windows.update).toHaveBeenCalledWith(101, { focused: true });
  });
  it('restores only missing URLs by default', async () => {
    const api = setup(['https://a.test/', 'https://b.test/', 'https://c.test/']);
    const result = await restoreWindows(windows);
    expect(result.skippedUrls).toHaveLength(3);
    expect(api.windows.create).not.toHaveBeenCalled();
  });
  it('reports failure and continues restoring other windows', async () => {
    const api = setup();
    api.windows.create.mockRejectedValueOnce(new Error('Window creation failed'));
    const result = await restoreWindows(windows);
    expect(result.failedUrls).toEqual(['https://a.test/']);
    expect(result.restoredTabIds).toHaveLength(2);
    expect(result.errors[0]).toContain('Window creation failed');
  });
  it('rejects executable and stale extension URLs', async () => {
    const api = setup();
    const result = await restoreWindows([{ ...windows[0], tabs: [
      { ...windows[0].tabs[0], url: 'javascript:alert(1)' },
      { ...windows[0].tabs[0], url: 'chrome-extension://old/page.html' },
    ] }]);
    expect(result.failedUrls).toHaveLength(2);
    expect(api.windows.create).not.toHaveBeenCalled();
  });
});
