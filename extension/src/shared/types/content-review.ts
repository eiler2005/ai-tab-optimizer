import type { TabRecord } from './tab';

export interface SimilarContentGroup {
  id: string;
  tabIds: number[];
  keepTabId: number;
  reason: string;
  confidence: number;
  source: 'titles' | 'content' | 'ai';
  relation: 'redundant' | 'related';
  uniqueValue?: string;
}

export interface ContentReviewPreview {
  id: string;
  createdAt: number;
  tabs: TabRecord[];
  similarGroups: SimilarContentGroup[];
  outdatedTabs: OutdatedContentTab[];
  protectedDomains: string[];
  extractedCount: number;
  extractionFailed: number;
  aiTabCount: number;
  provider?: string;
  warning?: string;
  excludedChats?: number;
  excerptTabIds?: number[];
}

export interface ReviewProgress {
  phase: 'capture' | 'extract' | 'compare' | 'ai' | 'complete';
  processed: number;
  total: number;
}

export interface ContentReviewJob extends ReviewProgress {
  id: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
  startedAt: number;
  updatedAt: number;
  phaseStartedAt: number;
  options: ContentReviewOptions;
  previewId?: string;
  preview?: ContentReviewPreview;
  error?: string;
}

export interface ContentReviewOptions {
  windowId?: number;
  useAi: boolean;
  readContent: boolean;
  focus?: string;
}

export interface ReviewCloseDecision { tabId: number; keepTabId?: number }

export interface OutdatedContentTab {
  tabId: number;
  reason: string;
  evidence: string;
  confidence: number;
  replacementTabId?: number;
}
