export interface TabRecord {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  domain: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  groupId?: number;
  groupName?: string;
  lastAccessed?: number;
  ruleFlags?: RuleFlags;
  userFlag?: 'important' | 'read_later' | 'protected';
}

export interface RuleFlags {
  isExactDuplicate: boolean;
  duplicateOfTabId?: number;
  isNearDuplicate: boolean;
  isStale: boolean;
  domainGroup: string;
}

export interface WindowGroup {
  windowId: number;
  focused: boolean;
  tabs: TabRecord[];
}
