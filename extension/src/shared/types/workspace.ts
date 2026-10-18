import type { TabRecord, WindowGroup } from './tab';

export interface DuplicateReviewGroup {
  id: string;
  kind: 'exact' | 'tracking';
  reason: string;
  tabs: TabRecord[];
  keepTabId: number;
}

export interface DuplicatePreview {
  id: string;
  createdAt: number;
  groups: DuplicateReviewGroup[];
  protectedDomains: string[];
}

export interface CloseDecision { tabId: number; keepTabId: number }

export interface WindowMergePreview {
  id: string;
  createdAt: number;
  targetWindowId: number;
  originalFocusedWindowId?: number;
  targetActiveTabId?: number;
  tabs: TabRecord[];
}

export interface OperationItem {
  tab: TabRecord;
  keep?: TabRecord;
  state: 'pending' | 'applying' | 'done' | 'failed' | 'skipped' | 'restoring' | 'undone' | 'uncertain';
  error?: string;
  restoredTabId?: number;
  movedGroupId?: number;
}

export interface TabOperation {
  id: string;
  kind: 'close' | 'move';
  createdAt: number;
  browserSessionId: string;
  status: 'running' | 'completed' | 'partial' | 'interrupted' | 'undoing' | 'undone';
  items: OperationItem[];
  targetWindowId?: number;
  targetActiveTabId?: number;
  originalFocusedWindowId?: number;
  undoBrowserSessionId?: string;
  undoWindows?: Record<string, number>;
}

export interface SavedCollection {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  windows: WindowGroup[];
}

export interface WorkspaceData {
  version: 1;
  revision: number;
  operations: TabOperation[];
  collections: SavedCollection[];
}
