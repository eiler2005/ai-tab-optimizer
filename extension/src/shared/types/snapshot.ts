export interface SnapshotRecord {
  id: string;
  name: string;
  createdAt: number;
  trigger: 'manual' | 'auto' | 'pre-cleanup';
  windows: WindowSnapshot[];
  stats: {
    totalTabs: number;
    totalWindows: number;
    topDomains: string[];
  };
}

export interface WindowSnapshot {
  windowId: number;
  focused: boolean;
  tabs: TabSnapshot[];
}

export interface TabSnapshot {
  active?: boolean;
  groupId?: number;
  groupColor?: chrome.tabGroups.TabGroup['color'];
  groupCollapsed?: boolean;
  url: string;
  title: string;
  domain: string;
  pinned: boolean;
  favIconUrl?: string;
  groupName?: string;
}
