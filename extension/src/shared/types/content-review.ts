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
  savedSources?: Record<number, { collectionId: string; itemId: string; revision: number; collectionName: string }>;
  evidence?: Record<number, { text: string; capturedAt: number; cached: boolean }>;
  focus?: string;
  retainedByUser?: number;
  reviewEligibleCount?: number;
}

export interface ReviewProgress {
  phase: 'capture' | 'extract' | 'compare' | 'ai' | 'complete';
  processed: number;
  total: number;
}

export interface ContentReviewJob extends ReviewProgress {
  previewExpired?: boolean;
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
  tabIds?: number[];
  expectedUrls?: Record<number, string>;
  scopeLabel?: string;
  windowId?: number;
  useAi: boolean;
  readContent: boolean;
  focus?: string;
  includeSaved?: boolean;
  deepUrls?: string[];
}

export interface ReviewCloseDecision { tabId: number; keepTabId?: number }

export interface OutdatedContentTab {
  tabId: number;
  reason: string;
  evidence: string;
  confidence: number;
  replacementTabId?: number;
}
