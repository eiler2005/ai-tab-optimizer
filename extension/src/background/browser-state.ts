import type { TabRecord, WindowGroup } from '@shared/types';
import { extractDomain } from '@shared/utils/url';

export async function readBrowserState(): Promise<WindowGroup[]> {
  const [tabs, windows, groups, stored] = await Promise.all([
    chrome.tabs.query({ windowType: 'normal' }), chrome.windows.getAll(),
    chrome.tabGroups.query({}), chrome.storage.local.get(['userFlags', 'userFlagsV2']),
  ]);
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  const flags = (stored.userFlagsV2 ?? {}) as Record<string, TabRecord['userFlag']>;
  if (!stored.userFlagsV2 && stored.userFlags) {
    const legacy = stored.userFlags as Record<number, TabRecord['userFlag']>;
    for (const tab of tabs) if (tab.id !== undefined && tab.url && legacy[tab.id]) flags[tab.url] = legacy[tab.id];
    await chrome.storage.local.set({ userFlagsV2: flags });
  }
  const byWindow = new Map<number, WindowGroup>();
  for (const tab of tabs) {
    if (tab.incognito || tab.id === undefined) continue;
    const group = groupMap.get(tab.groupId);
    const window = byWindow.get(tab.windowId) ?? { windowId: tab.windowId,
      focused: windows.find((item) => item.id === tab.windowId)?.focused ?? false, tabs: [] };
    window.tabs.push({ id: tab.id, windowId: tab.windowId, index: tab.index, url: tab.url ?? '',
      title: tab.title ?? '', domain: extractDomain(tab.url ?? ''), pinned: tab.pinned, active: tab.active,
      audible: tab.audible, lastAccessed: tab.lastAccessed, favIconUrl: tab.favIconUrl,
      groupId: group?.id, groupName: group?.title, groupColor: group?.color,
      groupCollapsed: group?.collapsed, userFlag: flags[tab.url ?? ''] });
    byWindow.set(tab.windowId, window);
  }
  return [...byWindow.values()].map((window) => ({ ...window, tabs: window.tabs.sort((a, b) => a.index - b.index) }))
    .sort((a, b) => Number(b.focused) - Number(a.focused) || a.windowId - b.windowId);
}
