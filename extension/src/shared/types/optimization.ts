import type { TabRecord } from './tab';

export type OptimizationCategory = 'exact' | 'tracking' | 'redundant' | 'outdated' | 'saved';
export interface OptimizationCandidate {
  tab: TabRecord;
  keep?: TabRecord;
  category: OptimizationCategory;
  reason: string;
  recommended: boolean;
  savedIn?: { collectionId: string; itemId: string; revision: number; name: string };
}
export interface OptimizationPlan {
  id: string;
  createdAt: number;
  windowId?: number;
  tabsBefore: number;
  candidates: OptimizationCandidate[];
  protectedCount: number;
  chatCount: number;
  relatedGroups: number;
  aiCompared: number;
  warning?: string;
}
export interface OptimizationReport {
  tabsBefore: number;
  tabsAfter: number;
  requested: number;
  closed: number;
  skipped: number;
  failed: number;
  archived?: number;
  duplicatesClosed?: number;
  outdatedClosed?: number;
}
