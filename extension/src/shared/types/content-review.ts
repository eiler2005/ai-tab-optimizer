import type { TabRecord } from './tab';

export interface SimilarContentGroup {
  id: string;
  tabIds: number[];
  keepTabId: number;
  reason: string;
  confidence: number;
  source: 'titles' | 'content' | 'ai';
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
