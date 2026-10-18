import { readBrowserState } from './browser-state';

export async function collapseTopic(tabIds: number[], name: string, collapsed: boolean): Promise<number[]> {
  if (!name.trim() || name.length > 120 || !tabIds.length) throw new Error('Choose a named topic');
  const selected = new Set(tabIds);
  const windows = await readBrowserState();
  const tabs = windows.flatMap((window) => window.tabs).filter((tab) => selected.has(tab.id));
  if (tabs.length !== selected.size) throw new Error('Some topic tabs changed; refresh the topic');
  const groups: number[] = [];
  for (const window of windows) {
    const members = window.tabs.filter((tab) => selected.has(tab.id) && !tab.pinned);
    if (!members.length) continue;
    const ids = members.map((tab) => tab.id) as [number, ...number[]];
    const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: window.windowId } });
    await chrome.tabGroups.update(groupId, { title: name.trim(), collapsed });
    groups.push(groupId);
  }
  return groups;
}
