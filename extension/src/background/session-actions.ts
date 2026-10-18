import type { WindowSnapshot, TabSnapshot } from '@shared/types/snapshot';

export interface RestoreResult {
  restoredTabIds: number[];
  failedUrls: string[];
  skippedUrls: string[];
  errors: string[];
}

export function isRestorableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'file:'].includes(url.protocol)
      || value === 'about:blank' || value === 'chrome://newtab/';
  } catch {
    return false;
  }
}

export async function restoreWindows(windows: WindowSnapshot[], skipExisting = true): Promise<RestoreResult> {
  const result: RestoreResult = { restoredTabIds: [], failedUrls: [], skippedUrls: [], errors: [] };
  const existing = new Set(skipExisting ? (await chrome.tabs.query({})).map((tab) => tab.url) : []);
  let focusedWindow: number | undefined;
  for (const window of windows) {
    let windowId: number | undefined;
    const groups = new Map<string, { info: TabSnapshot; ids: number[] }>();
    let activeId: number | undefined;
    for (const tab of window.tabs) {
      if (existing.has(tab.url)) { result.skippedUrls.push(tab.url); continue; }
      if (!isRestorableUrl(tab.url)) { result.failedUrls.push(tab.url); continue; }
      try {
        let created: chrome.tabs.Tab | undefined;
        if (windowId === undefined) {
          const createdWindow = await chrome.windows.create({ url: tab.url, focused: false });
          windowId = createdWindow?.id;
          created = createdWindow?.tabs?.[0];
          if (windowId !== undefined && !created) created = (await chrome.tabs.query({ windowId }))[0];
        } else {
          created = await chrome.tabs.create({ windowId, url: tab.url, active: false });
        }
        if (created?.id === undefined) throw new Error('Browser did not return the restored tab');
        result.restoredTabIds.push(created.id);
        if (skipExisting) existing.add(tab.url);
        await chrome.tabs.update(created.id, { pinned: tab.pinned });
        if (tab.active) activeId = created.id;
        if (!tab.pinned && (tab.groupKey || tab.groupId !== undefined || tab.groupName)) {
          const key = tab.groupKey ?? (tab.groupId === undefined ? 'name:' + tab.groupName : 'id:' + tab.groupId);
          const group = groups.get(key) ?? { info: tab, ids: [] };
          group.ids.push(created.id);
          groups.set(key, group);
        }
      } catch (error) {
        result.failedUrls.push(tab.url);
        result.errors.push(String(error));
      }
    }
    for (const { info, ids } of groups.values()) {
      try {
        const groupId = await chrome.tabs.group({ tabIds: ids as [number, ...number[]], createProperties: { windowId } });
        await chrome.tabGroups.update(groupId, { title: info.groupName ?? '',
          color: info.groupColor ?? 'grey', collapsed: info.groupCollapsed ?? false });
      } catch (error) { result.errors.push(String(error)); }
    }
    if (activeId !== undefined) {
      try { await chrome.tabs.update(activeId, { active: true }); }
      catch (error) { result.errors.push(String(error)); }
    }
    if (window.focused && windowId !== undefined) focusedWindow = windowId;
  }
  if (focusedWindow !== undefined) {
    try { await chrome.windows.update(focusedWindow, { focused: true }); }
    catch (error) { result.errors.push(String(error)); }
  }
  return result;
}
