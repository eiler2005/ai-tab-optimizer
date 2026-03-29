import type { TabRecord, WindowGroup } from './tab';
import type { SnapshotRecord } from './snapshot';
import type { AIAnalysisResult, AIAnalysisMetadata, AIProgress, RecommendedAction, LLMCallLogEntry, HabitsScore, RecommendationAction, RecommendationActionStats, ActivityHeatmapData, PersistentCluster, TabAnalysisStatus, TabAnalysisStatusSummary, ChatSearchResult, ChatHistoryMessage, AIProviderId, AnalyticsInsight, TopicCluster } from './ai';
import type { HistoryTimeframe, TabHistoryStats } from './history';

// --- Requests (Side Panel → Service Worker) ---

export type MessageRequest =
  | { type: 'GET_ALL_TABS' }
  | { type: 'CLOSE_TABS'; tabIds: number[] }
  | { type: 'PIN_TAB'; tabId: number; pinned: boolean }
  | { type: 'SET_USER_FLAG'; tabId: number; flag: TabRecord['userFlag'] | null }
  | { type: 'CREATE_SNAPSHOT'; name?: string; trigger?: SnapshotTrigger }
  | { type: 'GET_SNAPSHOTS' }
  | { type: 'GET_SNAPSHOT'; id: string }
  | { type: 'DELETE_SNAPSHOT'; id: string }
  | { type: 'RESTORE_SNAPSHOT'; id: string; tabUrls?: string[] }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: Partial<UserSettings> }
  | { type: 'GET_SERVER_DB_STATUS' }
  | { type: 'GET_SERVER_RUNTIME_LOGS'; limit?: number }
  | { type: 'SYNC_SERVER_PERSISTENCE' }
  | { type: 'CLEAR_SERVER_DB' }
  | { type: 'GET_TAB_HISTORY'; timeframe: HistoryTimeframe; limit?: number; offset?: number }
  | { type: 'GET_TAB_ANALYSIS_STATUS'; forceRefresh?: boolean }
  | { type: 'ANALYZE_TABS'; forceRefresh?: boolean; resume?: boolean }
  | { type: 'STOP_AI_ANALYSIS' }
  | { type: 'GET_AI_RESULT' }
  | { type: 'EXTRACT_PAGE'; tabId: number }
  | { type: 'START_CLEANUP_SESSION' }
  | { type: 'APPLY_CLEANUP_ACTION'; tabId: number; action: RecommendedAction }
  | { type: 'GET_LLM_CALL_LOGS'; limit?: number; sessionTimestamp?: number; provider?: string }
  | { type: 'GET_URL_CACHE_LIST'; limit?: number; offset?: number; domain?: string; action?: string }
  | { type: 'DELETE_URL_CACHE'; urls?: string[]; domainPattern?: string }
  | { type: 'GET_ANALYSIS_SESSIONS'; limit?: number; offset?: number }
  | { type: 'DELETE_ANALYSIS_SESSION'; sessionId: number }
  | { type: 'GROUP_TABS_BY_CLUSTER'; tabIds: number[]; name: string; color?: string }
  | { type: 'GET_TAB_INSIGHTS' }
  | { type: 'GET_HABITS_SCORE' }
  | { type: 'TRACK_RECOMMENDATION'; action: RecommendationAction }
  | { type: 'GET_RECOMMENDATION_STATS' }
  | { type: 'GET_ACTIVITY_HEATMAP'; domain?: string }
  | { type: 'GET_PERSISTENT_CLUSTERS' }
  | { type: 'MERGE_AI_CLUSTERS'; clusters: { name: string; description: string; tags: string[]; tabUrls: string[] }[] }
  | { type: 'RENAME_CLUSTER'; clusterId: number; name: string }
  | { type: 'DELETE_CLUSTER'; clusterId: number }
  | { type: 'FOCUS_ON_CLUSTER'; clusterId: number }
  | { type: 'EXIT_FOCUS_MODE' }
  | { type: 'GET_CLUSTER_TAB_MATCHES'; clusterId: number }
  | { type: 'OPEN_URL'; url: string }
  | { type: 'FOCUS_TAB'; tabId: number }
  | { type: 'CHAT_SEARCH'; query: string; history?: ChatHistoryMessage[]; maxResults?: number }
  | { type: 'REFRESH_ANALYTICS' };

export type SnapshotTrigger = 'manual' | 'auto' | 'pre-cleanup';

// --- Responses (Service Worker → Side Panel) ---

export type MessageResponse =
  | { success: true; data?: unknown }
  | { success: false; error: string };

export interface GetAllTabsResponse {
  success: true;
  data: {
    windowGroups: WindowGroup[];
    totalTabs: number;
  };
}

export interface GetSnapshotsResponse {
  success: true;
  data: {
    snapshots: SnapshotRecord[];
  };
}

export interface GetTabHistoryResponse {
  success: true;
  data: {
    stats: TabHistoryStats[];
    total: number;
  };
}

export interface GetAIResultResponse {
  success: true;
  data: {
    result: AIAnalysisResult;
    analyzedAt: number;
    metadata?: AIAnalysisMetadata;
    fingerprint?: string;
    progress?: AIProgress | null;
    status?: 'running' | 'stopped' | 'completed' | 'failed';
    resumable?: boolean;
    runId?: string;
    tabStatuses?: TabAnalysisStatus[];
    statusSummary?: TabAnalysisStatusSummary;
  };
}

export interface GetTabAnalysisStatusResponse {
  success: true;
  data: {
    statuses: TabAnalysisStatus[];
    summary: TabAnalysisStatusSummary;
  };
}

export interface ServerDbStatus {
  urlCacheEntries: number;
  analysisSessions: number;
  analysisRuns: number;
  historyEvents: number;
  snapshots: number;
  runtimeLogs: number;
  llmCallLogs: number;
  dbSizeBytes: number;
  lastAnalysisAt?: number | null;
  lastLogAt?: number | null;
}

export interface ServerRuntimeLogEntry {
  id: number;
  timestamp: number;
  level: 'info' | 'warning' | 'error';
  category: 'analysis' | 'provider' | 'database';
  message: string;
}

export interface GetServerDbStatusResponse {
  success: true;
  data: {
    status: ServerDbStatus;
  };
}

export interface GetServerRuntimeLogsResponse {
  success: true;
  data: {
    logs: ServerRuntimeLogEntry[];
  };
}

export interface GetLLMCallLogsResponse {
  success: true;
  data: {
    logs: LLMCallLogEntry[];
  };
}

export interface UrlCacheEntry {
  url: string;
  action: string;
  confidence: number;
  reason: string;
  suggestedGroupName: string | null;
  analyzedAt: number;
  analysisSource?: string;
  provider?: string | null;
  model?: string | null;
}

export interface GetUrlCacheListResponse {
  success: true;
  data: {
    entries: UrlCacheEntry[];
    total: number;
  };
}

export interface AnalysisSessionEntry {
  id: number;
  timestamp: number;
  tabCount: number;
  tabsFromCache: number;
  tabsAnalyzed: number;
  durationMs: number;
  durationApiMs: number;
  wallTimeMs: number;
  totalCostUsd: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface GetAnalysisSessionsResponse {
  success: true;
  data: {
    sessions: AnalysisSessionEntry[];
  };
}

export interface TabInsights {
  topDomains: { domain: string; count: number }[];
  avgAnalysisStats: {
    avgTabs: number;
    avgCost: number | null;
    avgDurationMs: number;
    totalSessions: number;
  };
  snapshotTrend: { timestamp: number; tabCount: number }[];
}

export interface GetTabInsightsResponse {
  success: true;
  data: {
    insights: TabInsights;
  };
}

export interface GetHabitsScoreResponse {
  success: true;
  data: {
    habitsScore: HabitsScore;
  };
}

export interface GetRecommendationStatsResponse {
  success: true;
  data: {
    stats: RecommendationActionStats;
  };
}

export interface GetActivityHeatmapResponse {
  success: true;
  data: {
    heatmap: ActivityHeatmapData;
  };
}

export interface GetPersistentClustersResponse {
  success: true;
  data: {
    clusters: PersistentCluster[];
  };
}

export interface GetClusterTabMatchesResponse {
  success: true;
  data: {
    matchedTabIds: number[];
    clusterName: string;
  };
}

export interface FocusOnClusterResponse {
  success: true;
  data: {
    matchedTabIds: number[];
    groupId: number | null;
    clusterName: string;
  };
}

export interface ChatSearchResponse {
  success: true;
  data: {
    answer: string;
    results: ChatSearchResult[];
    followUpSuggestions: string[];
    llmUsed: boolean;
    totalCandidates: number;
    providerUsed: AIProviderId | null;
    modelUsed: string | null;
  };
}

export interface RefreshAnalyticsResponse {
  success: true;
  data: {
    analyticsInsight: AnalyticsInsight | null;
    topicClusters?: TopicCluster[];
    providerUsed: string | null;
    modelUsed: string | null;
    error: string | null;
  };
}

// --- Events (Service Worker → Side Panel, broadcast) ---

export type BroadcastEvent =
  | { type: 'TABS_UPDATED' }
  | { type: 'SNAPSHOT_CREATED'; snapshot: SnapshotRecord }
  | { type: 'AI_ANALYSIS_COMPLETE'; result: AIAnalysisResult; metadata?: AIAnalysisMetadata; fromCache?: boolean; tabStatuses?: TabAnalysisStatus[]; statusSummary?: TabAnalysisStatusSummary }
  | { type: 'AI_ANALYSIS_ERROR'; error: string }
  | { type: 'AI_ANALYSIS_CANCELED'; result?: AIAnalysisResult; metadata?: AIAnalysisMetadata; progress?: AIProgress | null; resumable?: boolean; runId?: string; tabStatuses?: TabAnalysisStatus[]; statusSummary?: TabAnalysisStatusSummary }
  | { type: 'AI_ANALYSIS_PROGRESS'; progress: AIProgress }
  | { type: 'AI_ANALYSIS_PARTIAL'; result: AIAnalysisResult; progress: AIProgress; metadata?: AIAnalysisMetadata; tabStatuses?: TabAnalysisStatus[]; statusSummary?: TabAnalysisStatusSummary }
  | { type: 'HISTORY_UPDATED' };

// --- Settings ---

export interface UserSettings {
  obsidianVaultPath: string;
  protectedDomains: string[];
  staleDaysThreshold: number;
  maxStoredSnapshots: number;
  aiProvider: 'anthropic' | 'openai' | 'ollama' | 'local_server' | 'none';
  serverAiProvider: 'none' | 'claude_code' | 'codex_cli';
  fallbackAiProvider: 'none' | 'claude_code' | 'codex_cli';
  apiKey: string;
  ollamaEndpoint: string;
  localServerUrl: string;
  claudeCliPath: string;
  codexCliPath: string;
  codexModel: string;
  autoSnapshotEnabled: boolean;
  autoSnapshotIntervalHours: number;
  historyRetentionDays: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  obsidianVaultPath: '',
  protectedDomains: [],
  staleDaysThreshold: 7,
  maxStoredSnapshots: 30,
  aiProvider: 'local_server',
  serverAiProvider: 'claude_code',
  fallbackAiProvider: 'codex_cli',
  apiKey: '',
  ollamaEndpoint: 'http://localhost:11434',
  localServerUrl: 'http://localhost:8765',
  claudeCliPath: '',
  codexCliPath: '',
  codexModel: 'gpt-5.4',
  autoSnapshotEnabled: false,
  autoSnapshotIntervalHours: 4,
  historyRetentionDays: 30,
};
