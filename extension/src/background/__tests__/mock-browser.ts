import { vi } from 'vitest';
import type { TabRecord } from '@shared/types';

export function mockBrowser(records: TabRecord[]) {
  let nextId = 1000;
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const tabs = new Map(records.map((tab) => [tab.id, { ...tab, incognito: false, groupId: tab.groupId ?? -1 }]));
  const windows = new Map(records.map((tab) => [tab.windowId, { id: tab.windowId, focused: tab.windowId === 1, incognito: false, type: 'normal' }]));
  const groups = new Map<number, { id: number; windowId: number; title: string; color: string; collapsed: boolean }>();
  for (const tab of records) if (tab.groupId !== undefined) groups.set(tab.groupId, {
    id: tab.groupId, windowId: tab.windowId, title: tab.groupName ?? '', color: tab.groupColor ?? 'grey', collapsed: tab.groupCollapsed ?? false,
  });
  function store(data: Record<string, unknown>) {
    return {
      get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in data).map((key) => [key, structuredClone(data[key])]))),
      set: vi.fn(async (changes: Record<string, unknown>) => { Object.assign(data, structuredClone(changes)); }),
      remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }),
    };
  }
  function getTab(id: number) {
    const tab = tabs.get(id);
    if (!tab) throw new Error('No tab with id: ' + id);
    return tab;
  }
  function removeEmptyWindowsAndGroups() {
    for (const [id] of windows) if (![...tabs.values()].some((tab) => tab.windowId === id)) windows.delete(id);
    for (const [id] of groups) if (![...tabs.values()].some((tab) => tab.groupId === id)) groups.delete(id);
  }
  function moveTab(id: number, properties: { windowId: number; index: number }, keepGroup = false) {
    const tab = getTab(id);
    if (!windows.has(properties.windowId)) throw new Error('No target window');
    const oldWindow = tab.windowId;
    const destination = [...tabs.values()].filter((candidate) => candidate.windowId === properties.windowId && candidate.id !== id).sort((a, b) => a.index - b.index);
    tab.windowId = properties.windowId;
    if (!keepGroup && oldWindow !== tab.windowId) tab.groupId = -1;
    destination.splice(properties.index < 0 ? destination.length : Math.min(properties.index, destination.length), 0, tab);
    destination.forEach((candidate, index) => { candidate.index = index; });
    [...tabs.values()].filter((candidate) => candidate.windowId === oldWindow).sort((a, b) => a.index - b.index).forEach((candidate, index) => { candidate.index = index; });
    removeEmptyWindowsAndGroups();
    return { ...tab };
  }
  const api = {
    storage: { local: store(local), session: store(session) },
    tabs: {
      query: vi.fn(async (query: { windowId?: number } = {}) => [...tabs.values()].filter((tab) => query.windowId === undefined || tab.windowId === query.windowId).map((tab) => ({ ...tab }))),
      get: vi.fn(async (id: number) => ({ ...getTab(id) })),
      remove: vi.fn(async (id: number) => {
        getTab(id); tabs.delete(id);
        removeEmptyWindowsAndGroups();
      }),
      move: vi.fn(async (id: number, properties: { windowId: number; index: number }) => moveTab(id, properties)),
      create: vi.fn(async (properties: { url?: string; windowId?: number; index?: number; pinned?: boolean; active?: boolean }) => {
        const id = ++nextId;
        const windowId = properties.windowId ?? [...windows.keys()][0];
        if (!windows.has(windowId)) throw new Error('No window with id: ' + windowId);
        const tab = { id, windowId, index: properties.index ?? tabs.size, url: properties.url ?? 'about:blank', title: '', domain: '', pinned: properties.pinned ?? false,
          active: properties.active ?? false, groupId: -1, incognito: false };
        tabs.set(id, tab); return { ...tab };
      }),
      update: vi.fn(async (id: number, properties: { pinned?: boolean; active?: boolean }) => {
        const tab = getTab(id); Object.assign(tab, properties); return { ...tab };
      }),
      group: vi.fn(async (properties: { tabIds: number[]; groupId?: number; createProperties?: { windowId?: number } }) => {
        const id = properties.groupId ?? ++nextId;
        const first = getTab(properties.tabIds[0]);
        const destination = groups.get(id)?.windowId ?? properties.createProperties?.windowId ?? [...windows.values()].find((window) => window.focused)?.id ?? first.windowId;
        if (!groups.has(id)) groups.set(id, { id, windowId: destination, title: '', color: 'grey', collapsed: false });
        for (const tabId of properties.tabIds) { const tab = getTab(tabId); tab.groupId = id; tab.windowId = destination; }
        removeEmptyWindowsAndGroups();
        return id;
      }),
    },
    windows: {
      getAll: vi.fn(async () => [...windows.values()].map((window) => ({ ...window }))),
      get: vi.fn(async (id: number) => { const window = windows.get(id); if (!window) throw new Error('No window'); return { ...window }; }),
      create: vi.fn(async (properties: { url?: string; focused?: boolean; tabId?: number }) => {
        const id = ++nextId; windows.set(id, { id, focused: properties.focused ?? false, incognito: false, type: 'normal' });
        if (properties.tabId !== undefined) {
          const tab = moveTab(properties.tabId, { windowId: id, index: 0 });
          return { id, tabs: [tab] };
        }
        const tabId = ++nextId;
        const tab = { id: tabId, windowId: id, index: 0, url: properties.url ?? 'about:blank', title: '', domain: '', pinned: false, active: true, incognito: false, groupId: -1 };
        tabs.set(tabId, tab); return { id, tabs: [{ ...tab }] };
      }),
      update: vi.fn(async (id: number, properties: { focused?: boolean }) => ({ id, ...properties })),
    },
    tabGroups: {
      TAB_GROUP_ID_NONE: -1,
      move: vi.fn(async (id: number, properties: { windowId: number; index: number }) => {
        const group = groups.get(id);
        if (!group) throw new Error('No group');
        const members = [...tabs.values()].filter((tab) => tab.groupId === id).sort((a, b) => a.index - b.index);
        for (const tab of members) moveTab(tab.id, properties, true);
        group.windowId = properties.windowId;
        return { ...group };
      }),
      query: vi.fn(async () => [...groups.values()].map((group) => ({ ...group }))),
      get: vi.fn(async (id: number) => { const group = groups.get(id); if (!group) throw new Error('No group'); return { ...group }; }),
      update: vi.fn(async (id: number, properties: object) => { Object.assign(groups.get(id)!, properties); return groups.get(id); }),
    },
  };
  vi.stubGlobal('chrome', api);
  return { api, tabs, windows, groups, local, session };
}
