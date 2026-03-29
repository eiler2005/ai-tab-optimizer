import { create } from 'zustand';
import type {
  WindowGroup,
  TabRecord,
  SnapshotRecord,
  AIAnalysisResult,
  AIAnalysisMetadata,
  AIProgress,
  TabAnalysisStatus,
  TabAnalysisStatusSummary,
  TabHistoryStats,
  HistoryTimeframe,
  RecommendedAction,
  TabRecommendation,
  MessageRequest,
  GetAllTabsResponse,
  GetSnapshotsResponse,
  GetTabHistoryResponse,
  GetAIResultResponse,
  GetTabAnalysisStatusResponse,
  FocusOnClusterResponse,
  ChatSearchResult,
  ChatHistoryMessage,
  ChatMessage,
  ChatSearchResponse,
  TabInsights,
  HabitsScore,
  RecommendationActionStats,
  ActivityHeatmapData,
  PersistentCluster,
  TopicCluster,
  GetTabInsightsResponse,
  GetHabitsScoreResponse,
  GetRecommendationStatsResponse,
  GetActivityHeatmapResponse,
  GetPersistentClustersResponse,
  AnalyticsInsight,
  RefreshAnalyticsResponse,
} from '@shared/types';
import { runRules } from '@shared/utils/rules';

export type View =
  | 'tabs'
  | 'snapshots'
  | 'snapshot-detail'
  | 'settings'
  | 'history'
  | 'ai-recommendations'
  | 'cleanup-session'
  | 'chat';

interface AppState {
  // Navigation
  view: View;
  setView: (view: View) => void;

  // Tabs
  windowGroups: WindowGroup[];
  totalTabs: number;
  loading: boolean;
  searchQuery: string;
  selectedTabIds: Set<number>;
  duplicateCount: number;
  nearDuplicateCount: number;
  staleCount: number;
  setSearchQuery: (q: string) => void;
  toggleTabSelection: (id: number) => void;
  selectAll: () => void;
  deselectAll: () => void;

  // Recently closed
  recentlyClosed: { url: string; title: string; sessionId: number }[];

  // Snapshots
  snapshots: SnapshotRecord[];
  activeSnapshotId: string | null;
  setActiveSnapshotId: (id: string | null) => void;

  // Tab History
  historyStats: TabHistoryStats[];
  historyTimeframe: HistoryTimeframe;
  historySearchQuery: string;
  historyLoading: boolean;
  historyTotal: number;
  historyHasMore: boolean;
  historyShowOpenOnly: boolean;
  setHistoryTimeframe: (tf: HistoryTimeframe) => void;
  setHistorySearchQuery: (q: string) => void;
  setHistoryShowOpenOnly: (v: boolean) => void;
  loadHistory: () => Promise<void>;
  loadMoreHistory: () => Promise<void>;

  // AI Analysis
  aiResult: AIAnalysisResult | null;
  aiAnalyzedAt: number | null;
  aiLoading: boolean;
  aiError: string | null;
  aiProgress: AIProgress | null;
  aiMetadata: AIAnalysisMetadata | null;
  aiFromCache: boolean;
  aiWasCanceled: boolean;
  aiResumeAvailable: boolean;
  aiRunId: string | null;
  aiTabStatuses: TabAnalysisStatus[];
  aiStatusSummary: TabAnalysisStatusSummary | null;
  aiTabStatusLoading: boolean;
  analyzeTabs: (forceRefresh?: boolean, resume?: boolean) => void;
  resumeAIAnalysis: () => void;
  stopAIAnalysis: () => Promise<void>;
  loadAIResult: () => Promise<void>;
  loadAITabStatuses: (forceRefresh?: boolean) => Promise<void>;
  setAIResult: (result: AIAnalysisResult, metadata?: AIAnalysisMetadata, fromCache?: boolean) => void;
  setAIPartialResult: (result: AIAnalysisResult, progress: AIProgress, metadata?: AIAnalysisMetadata) => void;
  setAIError: (error: string) => void;
  setAIProgress: (progress: AIProgress | null) => void;
  setAIStopped: (result?: AIAnalysisResult, metadata?: AIAnalysisMetadata, progress?: AIProgress | null, resumable?: boolean, runId?: string) => void;
  setAITabStatuses: (statuses: TabAnalysisStatus[], summary?: TabAnalysisStatusSummary | null) => void;

  // Cleanup Session
  cleanupStep: number;
  cleanupActions: Map<number, RecommendedAction>;
  cleanupRecommendations: TabRecommendation[];
  startCleanupSession: () => Promise<void>;
  applyCleanupAction: (tabId: number, action: RecommendedAction) => Promise<void>;
  skipCleanupStep: () => void;
  finishCleanup: () => void;

  // Focus Mode
  focusClusterId: number | null;
  focusClusterName: string | null;
  focusMatchedTabIds: number[];
  setFocusMode: (clusterId: number) => Promise<void>;
  exitFocusMode: () => Promise<void>;

  // Analytics
  insights: TabInsights | null;
  habitsScore: HabitsScore | null;
  recStats: RecommendationActionStats | null;
  heatmap: ActivityHeatmapData | null;
  persistentClusters: PersistentCluster[];
  persistentClustersLoading: boolean;
  analyticsRefreshing: boolean;
  analyticsRefreshError: string | null;
  analyticsInsight: AnalyticsInsight | null;
  loadAnalytics: (force?: boolean) => void;
  loadPersistentClusters: () => void;
  loadHeatmap: (domain?: string) => void;
  refreshAnalytics: () => Promise<void>;

  // Chat Search
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  sendChatQuery: (query: string) => Promise<void>;
  clearChat: () => void;

  // Actions
  loadTabs: () => Promise<void>;
  closeTabs: (ids: number[]) => Promise<void>;
  pinTab: (id: number, pinned: boolean) => Promise<void>;
  setUserFlag: (id: number, flag: TabRecord['userFlag'] | null) => Promise<void>;
  createSnapshot: (name?: string) => Promise<void>;
  loadSnapshots: () => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
  restoreSnapshot: (id: string, tabUrls?: string[]) => Promise<void>;
  loadRecentlyClosed: () => Promise<void>;
  restoreClosedTab: (sessionId: number) => Promise<void>;
}

async function sendMessage<T = unknown>(msg: MessageRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(msg);
  if (!response.success) throw new Error(response.error);
  return response.data as T;
}

export const useStore = create<AppState>((set, get) => ({
  // Navigation
  view: 'tabs',
  setView: (view) => set({ view }),

  // Tabs
  windowGroups: [],
  totalTabs: 0,
  loading: true,
  searchQuery: '',
  selectedTabIds: new Set(),
  duplicateCount: 0,
  nearDuplicateCount: 0,
  staleCount: 0,
  setSearchQuery: (q) => set({ searchQuery: q }),
  toggleTabSelection: (id) => {
    const selected = new Set(get().selectedTabIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    set({ selectedTabIds: selected });
  },
  selectAll: () => {
    const ids = new Set<number>();
    for (const wg of get().windowGroups) {
      for (const tab of wg.tabs) ids.add(tab.id);
    }
    set({ selectedTabIds: ids });
  },
  deselectAll: () => set({ selectedTabIds: new Set() }),

  // Recently closed
  recentlyClosed: [],

  // Snapshots
  snapshots: [],
  activeSnapshotId: null,
  setActiveSnapshotId: (id) => set({ activeSnapshotId: id, view: id ? 'snapshot-detail' : 'snapshots' }),

  // Tab History
  historyStats: [],
  historyTimeframe: 'day',
  historySearchQuery: '',
  historyLoading: false,
  historyTotal: 0,
  historyHasMore: false,
  historyShowOpenOnly: true,
  setHistoryTimeframe: (tf) => {
    set({ historyTimeframe: tf, historyStats: [], historyTotal: 0, historyHasMore: false });
    get().loadHistory();
  },
  setHistorySearchQuery: (q) => set({ historySearchQuery: q }),
  setHistoryShowOpenOnly: (v) => set({ historyShowOpenOnly: v }),
  loadHistory: async () => {
    set({ historyLoading: true });
    try {
      const data = await sendMessage<GetTabHistoryResponse['data']>({
        type: 'GET_TAB_HISTORY',
        timeframe: get().historyTimeframe,
        limit: 100,
        offset: 0,
      });
      set({
        historyStats: data.stats,
        historyTotal: data.total,
        historyHasMore: data.stats.length < data.total,
        historyLoading: false,
      });
    } catch {
      set({ historyLoading: false });
    }
  },
  loadMoreHistory: async () => {
    const { historyStats, historyTimeframe, historyHasMore, historyLoading } = get();
    if (!historyHasMore || historyLoading) return;
    set({ historyLoading: true });
    try {
      const data = await sendMessage<GetTabHistoryResponse['data']>({
        type: 'GET_TAB_HISTORY',
        timeframe: historyTimeframe,
        limit: 100,
        offset: historyStats.length,
      });
      const combined = [...historyStats, ...data.stats];
      set({
        historyStats: combined,
        historyTotal: data.total,
        historyHasMore: combined.length < data.total,
        historyLoading: false,
      });
    } catch {
      set({ historyLoading: false });
    }
  },

  // AI Analysis
  aiResult: null,
  aiAnalyzedAt: null,
  aiLoading: false,
  aiError: null,
  aiProgress: null,
  aiMetadata: null,
  aiFromCache: false,
  aiWasCanceled: false,
  aiResumeAvailable: false,
  aiRunId: null,
  aiTabStatuses: [],
  aiStatusSummary: null,
  aiTabStatusLoading: false,
  analyzeTabs: (forceRefresh, resume) => {
    set({
      aiResult: resume ? get().aiResult : null,
      aiAnalyzedAt: resume ? get().aiAnalyzedAt : null,
      aiLoading: true,
      aiError: null,
      aiProgress: resume ? get().aiProgress : null,
      aiMetadata: resume ? get().aiMetadata : null,
      aiFromCache: resume ? get().aiFromCache : false,
      aiWasCanceled: false,
      aiResumeAvailable: false,
    });
    // Fire-and-forget: results come via broadcasts
    sendMessage({ type: 'ANALYZE_TABS', forceRefresh, resume }).catch((err) => {
      set({ aiLoading: false, aiError: String(err), aiProgress: null });
    });
  },
  resumeAIAnalysis: () => {
    get().analyzeTabs(false, true);
  },
  stopAIAnalysis: async () => {
    const currentProgress = get().aiProgress;
    if (currentProgress) {
      set({
        aiProgress: {
          ...currentProgress,
          phase: 'stopping',
        },
      });
    }
    await sendMessage({ type: 'STOP_AI_ANALYSIS' });
    const FORCE_STOP_MS = 8000;
    globalThis.setTimeout(() => {
      if (get().aiLoading) {
        set({ aiLoading: false, aiProgress: null });
      }
    }, FORCE_STOP_MS);
  },
  loadAIResult: async () => {
    try {
      const data = await sendMessage<GetAIResultResponse['data']>({ type: 'GET_AI_RESULT' });
      if (get().aiLoading) {
        return;
      }
      const urlToTabId = new Map<string, number>();
      for (const wg of get().windowGroups) {
        for (const tab of wg.tabs) {
          if (tab.url) urlToTabId.set(tab.url, tab.id);
        }
      }

      // Remap tabStatuses: match by URL to get current tabId
      const rawStatuses = data.tabStatuses ?? get().aiTabStatuses;
      const remappedStatuses = rawStatuses.map((s) => {
        const newId = urlToTabId.get(s.url);
        return newId !== undefined ? { ...s, tabId: newId } : s;
      });

      // Build old tabId → URL map from statuses (used to remap recommendations)
      const oldIdToUrl = new Map(rawStatuses.map((s) => [s.tabId, s.url]));

      let result = data.result;
      if (result) {
        result = {
          ...result,
          topicClusters: result.topicClusters.map((cl) => {
            if (cl.tabUrls && cl.tabUrls.length > 0) {
              // New format: remap via tabUrls
              return {
                ...cl,
                tabIds: cl.tabUrls
                  .map((u) => urlToTabId.get(u))
                  .filter((id): id is number => id !== undefined),
              };
            }
            // Old format: remap via statuses as URL bridge
            return {
              ...cl,
              tabIds: cl.tabIds
                .map((oldId) => {
                  const url = oldIdToUrl.get(oldId);
                  return url ? urlToTabId.get(url) : undefined;
                })
                .filter((id): id is number => id !== undefined),
            };
          }),
          tabRecommendations: result.tabRecommendations
            .map((rec) => {
              const url = oldIdToUrl.get(rec.tabId);
              if (!url) return null;
              const newId = urlToTabId.get(url);
              return newId !== undefined ? { ...rec, tabId: newId } : null;
            })
            .filter((rec): rec is NonNullable<typeof rec> => rec !== null),
        };
      }

      const resumable = data.resumable ?? false;
      set({
        aiResult: result,
        aiAnalyzedAt: data.analyzedAt,
        aiMetadata: data.metadata ?? null,
        aiProgress: data.progress ?? null,
        aiLoading: data.status === 'running',
        aiWasCanceled: data.status === 'stopped' || resumable,
        aiResumeAvailable: resumable,
        aiRunId: data.runId ?? null,
        aiTabStatuses: remappedStatuses,
        aiStatusSummary: data.status === 'running' ? (data.statusSummary ?? get().aiStatusSummary) : get().aiStatusSummary,
      });
    } catch {
      // No cached result — that's fine
    }
  },
  loadAITabStatuses: async (forceRefresh) => {
    set({ aiTabStatusLoading: true });
    try {
      const data = await sendMessage<GetTabAnalysisStatusResponse['data']>({
        type: 'GET_TAB_ANALYSIS_STATUS',
        forceRefresh,
      });
      const analyzedUrls = new Set(
        data.statuses
          .filter((s) => s.status === 'cached' || s.status === 'analyzed')
          .map((s) => s.url),
      );
      const allCurrentTabs = get().windowGroups.flatMap((wg) => wg.tabs);
      const freshSummary: TabAnalysisStatusSummary = {
        total: allCurrentTabs.length,
        cached: data.statuses.filter((s) => s.status === 'cached').length,
        analyzed: data.statuses.filter((s) => s.status === 'analyzed').length,
        pending: allCurrentTabs.filter((tab) => !tab.url || !analyzedUrls.has(tab.url)).length,
        failed: data.statuses.filter((s) => s.status === 'failed').length,
      };
      set({
        aiTabStatuses: data.statuses,
        aiStatusSummary: freshSummary,
        aiTabStatusLoading: false,
      });
    } catch {
      set({ aiTabStatusLoading: false });
    }
  },
  setAIResult: (result, metadata, fromCache) => set({
    aiResult: result,
    aiLoading: false,
    aiError: null,
    aiProgress: null,
    aiMetadata: metadata ?? null,
    aiFromCache: fromCache ?? false,
    aiWasCanceled: false,
    aiResumeAvailable: false,
    aiRunId: null,
    aiAnalyzedAt: Date.now(),
  }),
  setAIPartialResult: (result, progress, metadata) => set({
    aiResult: result,
    aiLoading: true,
    aiError: null,
    aiProgress: progress,
    aiMetadata: metadata ?? null,
    aiWasCanceled: false,
    aiResumeAvailable: false,
  }),
  setAIError: (error) => set({ aiError: error, aiLoading: false, aiProgress: null }),
  setAIProgress: (progress) => set({
    aiProgress: progress,
    aiLoading: progress ? progress.phase !== 'stopped' : false,
  }),
  setAIStopped: (result, metadata, progress, resumable, runId) => {
    const current = get();
    const finalResult = result ?? current.aiResult;
    set({
      aiLoading: false,
      aiError: null,
      aiProgress: progress ?? current.aiProgress,
      aiWasCanceled: true,
      aiResumeAvailable: resumable ?? Boolean(progress && progress.tabsRemaining > 0),
      aiRunId: runId ?? current.aiRunId,
      aiResult: finalResult,
      aiMetadata: metadata ?? current.aiMetadata,
      aiAnalyzedAt: finalResult ? Date.now() : current.aiAnalyzedAt,
    });
  },
  setAITabStatuses: (statuses, summary) => set({
    aiTabStatuses: statuses,
    aiStatusSummary: summary ?? null,
    aiTabStatusLoading: false,
  }),

  // Cleanup Session
  cleanupStep: 0,
  cleanupActions: new Map(),
  cleanupRecommendations: [],
  startCleanupSession: async () => {
    await sendMessage({ type: 'START_CLEANUP_SESSION' });
    const ai = get().aiResult;
    if (!ai) return;
    const recs = ai.tabRecommendations.filter((r) => r.action !== 'keep');
    set({
      cleanupStep: 0,
      cleanupActions: new Map(),
      cleanupRecommendations: recs,
      view: 'cleanup-session',
    });
  },
  applyCleanupAction: async (tabId, action) => {
    await sendMessage({ type: 'APPLY_CLEANUP_ACTION', tabId, action });
    const actions = new Map(get().cleanupActions);
    actions.set(tabId, action);
    set({
      cleanupActions: actions,
      cleanupStep: get().cleanupStep + 1,
    });
  },
  skipCleanupStep: () => {
    set({ cleanupStep: get().cleanupStep + 1 });
  },
  finishCleanup: () => {
    set({ view: 'ai-recommendations' });
  },

  // Focus Mode
  focusClusterId: null,
  focusClusterName: null,
  focusMatchedTabIds: [],
  setFocusMode: async (clusterId) => {
    const data = await sendMessage<FocusOnClusterResponse['data']>({ type: 'FOCUS_ON_CLUSTER', clusterId });
    set({
      focusClusterId: clusterId,
      focusClusterName: data.clusterName,
      focusMatchedTabIds: data.matchedTabIds,
    });
  },
  exitFocusMode: async () => {
    await sendMessage({ type: 'EXIT_FOCUS_MODE' });
    set({ focusClusterId: null, focusClusterName: null, focusMatchedTabIds: [] });
  },

  // Analytics
  insights: null,
  habitsScore: null,
  recStats: null,
  heatmap: null,
  persistentClusters: [],
  persistentClustersLoading: false,
  analyticsRefreshing: false,
  analyticsRefreshError: null,
  analyticsInsight: null,
  loadAnalytics: (force) => {
    if (force) {
      set({ insights: null, habitsScore: null, recStats: null, heatmap: null, analyticsRefreshing: true });
    }
    const state = get();
    let pending = 0;
    const maybeFinish = () => {
      pending--;
      if (pending <= 0 && get().analyticsRefreshing) set({ analyticsRefreshing: false });
    };
    if (force || !state.insights) {
      pending++;
      chrome.runtime.sendMessage({ type: 'GET_TAB_INSIGHTS' }).then((res: GetTabInsightsResponse | { success: false }) => {
        if ('data' in res && res.data) set({ insights: res.data.insights });
      }).finally(maybeFinish);
    }
    if (force || !state.habitsScore) {
      pending++;
      chrome.runtime.sendMessage({ type: 'GET_HABITS_SCORE' }).then((res: GetHabitsScoreResponse | { success: false }) => {
        if ('data' in res && res.data) set({ habitsScore: res.data.habitsScore });
      }).finally(maybeFinish);
    }
    if (force || !state.recStats) {
      pending++;
      chrome.runtime.sendMessage({ type: 'GET_RECOMMENDATION_STATS' }).then((res: GetRecommendationStatsResponse | { success: false }) => {
        if ('data' in res && res.data) set({ recStats: res.data.stats });
      }).finally(maybeFinish);
    }
    if (force || !state.heatmap) {
      pending++;
      chrome.runtime.sendMessage({ type: 'GET_ACTIVITY_HEATMAP' }).then((res: GetActivityHeatmapResponse | { success: false }) => {
        if ('data' in res && res.data) set({ heatmap: res.data.heatmap });
      }).finally(maybeFinish);
    }
    if (pending === 0 && force) set({ analyticsRefreshing: false });
  },
  loadPersistentClusters: () => {
    set({ persistentClustersLoading: true });
    chrome.runtime.sendMessage({ type: 'GET_PERSISTENT_CLUSTERS' }).then((res: GetPersistentClustersResponse | { success: false }) => {
      if ('data' in res && res.data) set({ persistentClusters: res.data.clusters });
      set({ persistentClustersLoading: false });
    }).catch(() => {
      set({ persistentClustersLoading: false });
    });
  },
  loadHeatmap: (domain) => {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVITY_HEATMAP', domain }).then((res: GetActivityHeatmapResponse | { success: false }) => {
      if ('data' in res && res.data) set({ heatmap: res.data.heatmap });
    });
  },
  refreshAnalytics: async () => {
    if (get().analyticsRefreshing) return;
    set({ analyticsRefreshing: true, analyticsInsight: null, analyticsRefreshError: null });
    get().loadAnalytics(true);
    get().loadPersistentClusters();
    try {
      const res = await sendMessage<RefreshAnalyticsResponse['data']>({ type: 'REFRESH_ANALYTICS' });
      if (res.analyticsInsight) {
        const updates: Partial<AppState> = {
          analyticsInsight: {
            ...res.analyticsInsight,
            providerUsed: res.providerUsed ?? undefined,
            modelUsed: res.modelUsed ?? undefined,
            refreshedAt: Date.now(),
          },
          analyticsRefreshError: null,
        };
        const rawClusters = res.topicClusters as unknown as Array<{
          name: string; description: string; tags: string[]; tabUrls: string[];
        }> | undefined;
        if (rawClusters && rawClusters.length > 0) {
          const currentResult = get().aiResult;
          if (currentResult) {
            const urlToTabId = new Map<string, number>();
            for (const wg of get().windowGroups) {
              for (const tab of wg.tabs) {
                if (tab.url) urlToTabId.set(tab.url, tab.id);
              }
            }
            const resolved: TopicCluster[] = rawClusters.map((cl) => ({
              name: cl.name,
              description: cl.description,
              tags: cl.tags,
              tabUrls: cl.tabUrls,
              tabIds: cl.tabUrls
                .map((u) => urlToTabId.get(u))
                .filter((id): id is number => id !== undefined),
            }));
            updates.aiResult = { ...currentResult, topicClusters: resolved };
          }
        }
        set(updates);
      } else {
        const errorMsg = (res as Record<string, unknown>).error;
        set({ analyticsRefreshError: typeof errorMsg === 'string' ? errorMsg : 'AI providers unavailable' });
      }
    } catch (err) {
      set({ analyticsRefreshError: err instanceof Error ? err.message : 'Analytics refresh failed' });
    } finally {
      set({ analyticsRefreshing: false });
    }
  },

  // Chat Search
  chatMessages: [],
  chatLoading: false,
  sendChatQuery: async (queryText) => {
    const history: ChatHistoryMessage[] = get().chatMessages.slice(-8).map((message) => ({
      role: message.role,
      content: message.content,
      resultUrls: message.results?.map((result) => result.url) ?? [],
    }));
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: queryText,
      timestamp: Date.now(),
    };
    set((state) => ({ chatMessages: [...state.chatMessages, userMsg], chatLoading: true }));
    try {
      const res = await sendMessage<ChatSearchResponse['data']>({
        type: 'CHAT_SEARCH',
        query: queryText,
        history,
      });
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: res.answer,
        results: res.results as ChatSearchResult[],
        followUpSuggestions: res.followUpSuggestions,
        llmUsed: res.llmUsed,
        totalCandidates: res.totalCandidates,
        providerUsed: res.providerUsed,
        modelUsed: res.modelUsed,
        timestamp: Date.now(),
      };
      set((state) => ({ chatMessages: [...state.chatMessages, assistantMsg], chatLoading: false }));
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: `Search failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: Date.now(),
      };
      set((state) => ({ chatMessages: [...state.chatMessages, errorMsg], chatLoading: false }));
    }
  },
  clearChat: () => set({ chatMessages: [] }),

  // Actions
  loadTabs: async () => {
    if (get().windowGroups.length === 0) set({ loading: true });
    try {
      const data = await sendMessage<GetAllTabsResponse['data']>({ type: 'GET_ALL_TABS' });

      const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      const staleDays = settingsRes?.data?.staleDaysThreshold ?? 7;

      const allTabs = data.windowGroups.flatMap((wg) => wg.tabs);
      const ruleResult = runRules(allTabs, staleDays);

      const flagMap = new Map(ruleResult.tabs.map((t) => [t.id, t.ruleFlags]));
      const windowGroups = data.windowGroups.map((wg) => ({
        ...wg,
        tabs: wg.tabs.map((tab) => ({ ...tab, ruleFlags: flagMap.get(tab.id) })),
      }));

      set({
        windowGroups,
        totalTabs: data.totalTabs,
        duplicateCount: ruleResult.duplicateCount,
        nearDuplicateCount: ruleResult.nearDuplicateCount,
        staleCount: ruleResult.staleCount,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  closeTabs: async (ids) => {
    await sendMessage({ type: 'CLOSE_TABS', tabIds: ids });
    const selected = new Set(get().selectedTabIds);
    for (const id of ids) selected.delete(id);
    set({ selectedTabIds: selected });
  },

  pinTab: async (id, pinned) => {
    await sendMessage({ type: 'PIN_TAB', tabId: id, pinned });
  },

  setUserFlag: async (id, flag) => {
    await sendMessage({ type: 'SET_USER_FLAG', tabId: id, flag });
    await get().loadTabs();
  },

  createSnapshot: async (name) => {
    await sendMessage({ type: 'CREATE_SNAPSHOT', name });
    await get().loadSnapshots();
  },

  loadSnapshots: async () => {
    const data = await sendMessage<GetSnapshotsResponse['data']>({ type: 'GET_SNAPSHOTS' });
    set({ snapshots: data.snapshots });
  },

  deleteSnapshot: async (id) => {
    await sendMessage({ type: 'DELETE_SNAPSHOT', id });
    await get().loadSnapshots();
    if (get().activeSnapshotId === id) {
      set({ activeSnapshotId: null, view: 'snapshots' });
    }
  },

  restoreSnapshot: async (id, tabUrls) => {
    await sendMessage({ type: 'RESTORE_SNAPSHOT', id, tabUrls });
  },

  loadRecentlyClosed: async () => {
    const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });
    const closed = sessions
      .filter((s) => s.tab)
      .map((s) => ({
        url: s.tab!.url ?? '',
        title: s.tab!.title ?? '',
        sessionId: Number(s.tab!.sessionId ?? 0),
      }))
      .filter((s) => s.url && s.sessionId);
    set({ recentlyClosed: closed });
  },

  restoreClosedTab: async (sessionId) => {
    await chrome.sessions.restore(String(sessionId));
    await get().loadRecentlyClosed();
  },
}));
