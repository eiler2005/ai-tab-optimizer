export interface AISessionInput {
  tabs: {
    id: number;
    title: string;
    url: string;
    domain: string;
    pinned: boolean;
    active: boolean;
    groupId?: number;
    groupName?: string;
    pageExcerpt?: string;
    metaDescription?: string;
  }[];
}

export interface AIAnalysisResult {
  summary: string;
  topicClusters: TopicCluster[];
  tabRecommendations: TabRecommendation[];
  duplicateGroups: DuplicateGroup[];
  staleTabIds: number[];
  sessionStats: {
    estimatedClosable: number;
    mainThemes: string[];
    urgentItems: number;
    actionBreakdown?: Partial<Record<RecommendedAction, number>>;
  };
}

export interface TopicCluster {
  name: string;
  tabIds: number[];
  tabUrls: string[];
  description: string;
  tags: string[];
}

export type RecommendedAction = 'keep' | 'group' | 'read_later' | 'archive' | 'close';

export interface TabRecommendation {
  tabId: number;
  action: RecommendedAction;
  confidence: number;
  reason: string;
  suggestedGroupName?: string;
}

export interface DuplicateGroup {
  canonicalTabId: number;
  duplicateTabIds: number[];
  reason: string;
}

export interface PageExtraction {
  tabId: number;
  metaDescription: string;
  h1: string;
  excerpt: string;
}

export interface AIAnalysisMetadata {
  durationMs: number;
  durationApiMs: number;
  totalCostUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  tabCount: number;
  providerUsed?: AIProviderId | null;
  modelUsed?: string | null;
  providerAttempts?: AIProviderAttempt[];
  providerStatus?: AIProviderRuntimeStatus;
}

export type TabAnalysisState = 'pending' | 'cached' | 'analyzed' | 'failed';
export type TabAnalysisSource = 'pending' | 'database' | 'provider' | 'heuristic';

export interface TabAnalysisStatus {
  tabId: number;
  url: string;
  title: string;
  domain: string;
  status: TabAnalysisState;
  source: TabAnalysisSource;
  action?: RecommendedAction | null;
  confidence?: number | null;
  reason?: string | null;
  suggestedGroupName?: string | null;
  analyzedAt?: number | null;
  provider?: AIProviderId | null;
  model?: string | null;
}

export interface TabAnalysisStatusSummary {
  total: number;
  cached: number;
  analyzed: number;
  pending: number;
  failed: number;
}

export type AIProgressPhase =
  | 'preparing'
  | 'sending'
  | 'analyzing'
  | 'persisting'
  | 'processing'
  | 'stopping'
  | 'stopped';

export type AIProviderId = 'claude_code' | 'codex_cli';

export interface AIProviderAttempt {
  provider: AIProviderId;
  model: string | null;
  status: 'succeeded' | 'failed';
  error?: string | null;
}

export interface AIProviderRuntimeStatus {
  primaryProvider: AIProviderId | 'none';
  fallbackProvider: AIProviderId | 'none';
  currentProvider: AIProviderId | null;
  currentModel: string | null;
  attempts: AIProviderAttempt[];
  lastError: string | null;
  servedFromCacheOnly: boolean;
}

export interface AIProgress {
  phase: AIProgressPhase;
  tabsTotal: number;
  tabsCached: number;
  tabsNew: number;
  tabsAnalyzed: number;
  tabsProcessed: number;
  tabsRemaining: number;
  tabsSaved: number;
  batchesTotal: number;
  batchesCompleted: number;
  currentBatch: number;
  startedAt: number;
  providerStatus?: AIProviderRuntimeStatus;
}

export interface CachedAIResult {
  result: AIAnalysisResult;
  analyzedAt: number;
  metadata?: AIAnalysisMetadata;
  fingerprint: string;
}

export interface LLMCallLogEntry {
  id: number;
  timestamp: number;
  sessionTimestamp: number | null;
  batchIndex: number;
  provider: string;
  model: string | null;
  phase: string;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  promptChars: number;
  responseChars: number;
  tabCount: number;
  errorMessage: string | null;
  requestSummary: string | null;
  responseSummary: string | null;
}

export interface HabitsScoreComponent {
  name: string;
  value: number;
  normalizedScore: number;
  weight: number;
}

export interface HabitsScore {
  score: number;
  trend: 'improving' | 'stable' | 'declining';
  components: HabitsScoreComponent[];
  computedAt: number;
}

export interface RecommendationAction {
  tabUrl: string;
  tabTitle?: string;
  aiAction: RecommendedAction;
  userAction: 'accepted' | 'skipped' | 'modified';
  confidence: number;
}

export interface RecommendationActionStats {
  totalActions: number;
  acceptanceRate: number;
  byAiAction: Record<string, {
    total: number;
    accepted: number;
    skipped: number;
    modified: number;
    avgConfidence: number;
  }>;
  confidenceCorrelation: { bucket: string; acceptanceRate: number }[];
}

export interface AnalyticsInsight {
  browsingPatterns: string;
  suggestions: string[];
  clusterInsights: { clusterName: string; insight: string }[];
  habitsCommentary: string;
  providerUsed?: string;
  modelUsed?: string;
  refreshedAt: number;
}

export interface ActivityHeatmapData {
  grid: number[][];
  domains: string[];
}

export interface PersistentCluster {
  id: number;
  name: string;
  description: string;
  tags: string[];
  tabUrls: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatSearchResult {
  url: string;
  title: string;
  domain: string;
  reason: string;
  relevanceScore: number;
  source: 'url_analysis' | 'tab_history' | 'cluster';
  action?: RecommendedAction | null;
  clusterNames?: string[];
  analyzedAt?: number | null;
  provider?: AIProviderId | null;
  model?: string | null;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  resultUrls?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  results?: ChatSearchResult[];
  followUpSuggestions?: string[];
  llmUsed?: boolean;
  totalCandidates?: number;
  providerUsed?: AIProviderId | null;
  modelUsed?: string | null;
  timestamp: number;
}

export interface CleanupReviewData {
  snapshotId: string;
  date: string;
  tabsBefore: number;
  tabsAfter: number;
  closedTabs: { title: string; url: string; reason: string }[];
  savedTabs: { title: string; url: string; note: string }[];
  groupedTabs: { groupName: string; count: number }[];
}
