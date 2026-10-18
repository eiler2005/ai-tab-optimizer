import type { TabRecord, WindowGroup } from './tab';
import type { TabSnapshot } from './snapshot';

export interface DuplicateReviewGroup {
  id: string;
  kind: 'exact' | 'tracking' | 'stateful';
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
  statefulReviewed?: boolean;
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
  optimizationReport?: import('./optimization').OptimizationReport;
}

export type CollectionPurpose = 'now' | 'later' | 'reference';
export interface CollectionDetails {
  purpose?: CollectionPurpose;
  reason?: string;
  focus?: string;
  reviewAt?: number | null;
}
export interface CollectionChange extends CollectionDetails {
  name?: string; deleted?: boolean; itemId?: string; note?: string; permanent?: boolean;
}

export interface SavedCollection extends CollectionDetails {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  deletedAt?: number;
  sourceCollectionIds?: string[];
  windows: CollectionWindow[];
}

export interface SavedTab extends TabSnapshot {
  itemId: string;
  savedAt: number;
  userFlag?: TabRecord['userFlag'];
  note?: string;
}

export interface CollectionWindow { id: string; focused: boolean; tabs: SavedTab[] }
export interface CollectionPreview { id: string; name: string; createdAt: number; windows: WindowGroup[] }
export interface CollectionMergePreview {
  id: string;
  name: string;
  createdAt: number;
  sourceRevisions: Record<string, number>;
  windows: CollectionWindow[];
  inputTabs: number;
  duplicatesRemoved: number;
}

export interface WorkspaceData {
  version: 1;
  revision: number;
  operations: TabOperation[];
  collections: SavedCollection[];
  importedBackupIds?: string[];
}
