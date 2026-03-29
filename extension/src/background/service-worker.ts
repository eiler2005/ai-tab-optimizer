import type {
  MessageRequest,
  MessageResponse,
  GetAllTabsResponse,
  GetSnapshotsResponse,
  GetTabHistoryResponse,
  GetAIResultResponse,
  GetTabAnalysisStatusResponse,
  UserSettings,
  ServerDbStatus,
  ServerRuntimeLogEntry,
  WindowGroup,
  TabRecord,
  SnapshotRecord,
  SnapshotTrigger,
  AIAnalysisResult,
  AIAnalysisMetadata,
  AIProgress,
  AIProviderAttempt,
  AIProviderId,
  AIProviderRuntimeStatus,
  AISessionInput,
  CachedAIResult,
  TabHistoryEntry,
  TabHistoryStats,
  HistoryTimeframe,
  PageExtraction,
  TabRecommendation,
  RecommendedAction,
  LLMCallLogEntry,
  UrlCacheEntry,
  AnalysisSessionEntry,
  TabInsights,
  HabitsScore,
  RecommendationAction,
  RecommendationActionStats,
  ActivityHeatmapData,
  PersistentCluster,
  TabAnalysisStatus,
  TabAnalysisStatusSummary,
  TopicCluster,
} from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types/messages';
import { runRules } from '@shared/utils/rules';
import { extractDomain } from '@shared/utils/url';
import { v4 as uuid } from 'uuid';

// ─── In-memory tab info cache (for onRemoved, since tab data is gone after removal) ─

const tabInfoCache = new Map<number, { url: string; title: string; domain: string }>();
let historyMutationQueue: Promise<unknown> = Promise.resolve();
let currentAnalysisController: AbortController | null = null;
let currentAnalysisRunId = 0;
let serverPersistenceSyncPromise: Promise<void> | null = null;
const ANALYSIS_BATCH_SIZE = 30;
const ANALYSIS_BATCH_TIMEOUT_MS = 150_000;
const SIDEPANEL_KEEPALIVE_PORT = 'sidepanel-keepalive';
const sidePanelKeepalivePorts = new Set<chrome.runtime.Port>();

function updateTabCache(tabId: number, url: string, title: string) {
  tabInfoCache.set(tabId, { url, title, domain: extractDomain(url) });
}

function isTrackableHistoryUrl(url: string): boolean {
  return Boolean(url) && url !== 'about:blank' && !url.startsWith('chrome://newtab/');
}

function queueHistoryMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = historyMutationQueue.then(operation, operation);
  historyMutationQueue = next.then(() => undefined, () => undefined);
  return next;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function registerKeepalivePort(port: chrome.runtime.Port) {
  sidePanelKeepalivePorts.add(port);

  port.onMessage.addListener((message: { type?: string } | undefined) => {
    if (message?.type === 'PING') {
      try {
        port.postMessage({ type: 'PONG', timestamp: Date.now() });
      } catch {
        // Ignore disconnect races.
      }
    }
  });

  port.onDisconnect.addListener(() => {
    sidePanelKeepalivePorts.delete(port);
  });
}

// ─── Tab Helpers ─────────────────────────────────────────

async function getAllTabs(): Promise<GetAllTabsResponse['data']> {
  const tabs = await chrome.tabs.query({});
  const windows = await chrome.windows.getAll();
  const groups = await chrome.tabGroups.query({});

  const groupMap = new Map(groups.map((g) => [g.id, g.title ?? '']));
  const windowFocusMap = new Map(windows.map((w) => [w.id, w.focused ?? false]));

  const windowGroups = new Map<number, WindowGroup>();

  for (const tab of tabs) {
    const wId = tab.windowId;
    if (!windowGroups.has(wId)) {
      windowGroups.set(wId, {
        windowId: wId,
        focused: windowFocusMap.get(wId) ?? false,
        tabs: [],
      });
    }

    const record: TabRecord = {
      id: tab.id!,
      windowId: wId,
      index: tab.index,
      url: tab.url ?? '',
      title: tab.title ?? '',
      domain: extractDomain(tab.url ?? ''),
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned,
      active: tab.active,
      groupId: tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? tab.groupId : undefined,
      groupName: tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
        ? groupMap.get(tab.groupId)
        : undefined,
      lastAccessed: tab.lastAccessed,
    };

    windowGroups.get(wId)!.tabs.push(record);

    // Populate cache
    updateTabCache(tab.id!, record.url, record.title);
  }

  for (const wg of windowGroups.values()) {
    wg.tabs.sort((a, b) => a.index - b.index);
  }

  const sorted = [...windowGroups.values()].sort((a, b) => {
    if (a.focused !== b.focused) return a.focused ? -1 : 1;
    return a.windowId - b.windowId;
  });

  return {
    windowGroups: sorted,
    totalTabs: tabs.length,
  };
}

// ─── Snapshots ───────────────────────────────────────────

async function getLocalSnapshots(): Promise<SnapshotRecord[]> {
  const result = await chrome.storage.local.get('snapshots');
  return (result.snapshots ?? []) as SnapshotRecord[];
}

async function saveLocalSnapshots(snapshots: SnapshotRecord[]): Promise<void> {
  await chrome.storage.local.set({ snapshots });
}

async function getLocalHistoryEntries(): Promise<TabHistoryEntry[]> {
  const result = await chrome.storage.local.get('tabHistory');
  return (result.tabHistory ?? []) as TabHistoryEntry[];
}

async function saveLocalHistoryEntries(history: TabHistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({ tabHistory: history });
}

async function syncLocalPersistenceToServer(): Promise<void> {
  const settings = await getSettings();
  const localHistory = await getLocalHistoryEntries();
  const localSnapshots = await getLocalSnapshots();

  if (localHistory.length === 0 && localSnapshots.length === 0) {
    return;
  }

  const keysToRemove: string[] = [];
  let lastError: unknown = null;

  if (localHistory.length > 0) {
    try {
      await fetchServerJson('/tab-history/import', {
        method: 'POST',
        body: JSON.stringify({ entries: localHistory }),
      }, settings.localServerUrl);
      keysToRemove.push('tabHistory');
    } catch (error) {
      lastError = error;
      console.warn('Failed to sync tab history buffer to server:', error);
    }
  }

  if (localSnapshots.length > 0) {
    try {
      await fetchServerJson('/snapshots/import', {
        method: 'POST',
        body: JSON.stringify({
          snapshots: localSnapshots,
          maxStoredSnapshots: settings.maxStoredSnapshots,
        }),
      }, settings.localServerUrl);
      keysToRemove.push('snapshots');
    } catch (error) {
      lastError = error;
      console.warn('Failed to sync snapshots buffer to server:', error);
    }
  }

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }

  const hadBufferedData = localHistory.length > 0 || localSnapshots.length > 0;
  if (hadBufferedData && keysToRemove.length === 0 && lastError) {
    throw lastError;
  }
}

function ensureServerPersistenceSync(): Promise<void> {
  if (!serverPersistenceSyncPromise) {
    serverPersistenceSyncPromise = syncLocalPersistenceToServer().finally(() => {
      serverPersistenceSyncPromise = null;
    });
  }
  return serverPersistenceSyncPromise;
}

async function getSnapshots(): Promise<SnapshotRecord[]> {
  try {
    try {
      await ensureServerPersistenceSync();
    } catch (error) {
      console.warn('Local persistence sync failed before loading snapshots:', error);
    }
    const data = await fetchServerJson<{ snapshots: SnapshotRecord[] }>('/snapshots');
    return data.snapshots;
  } catch {
    return getLocalSnapshots();
  }
}

async function createSnapshot(
  name?: string,
  trigger: SnapshotTrigger = 'manual'
): Promise<SnapshotRecord> {
  const { windowGroups, totalTabs } = await getAllTabs();
  const settings = await getSettings();

  const domainCount = new Map<string, number>();
  for (const wg of windowGroups) {
    for (const tab of wg.tabs) {
      domainCount.set(tab.domain, (domainCount.get(tab.domain) ?? 0) + 1);
    }
  }
  const topDomains = [...domainCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain]) => domain);

  const now = Date.now();
  const dateStr = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
  const snapshot: SnapshotRecord = {
    id: uuid(),
    name: name || `Snapshot ${dateStr}`,
    createdAt: now,
    trigger,
    windows: windowGroups.map((wg) => ({
      windowId: wg.windowId,
      focused: wg.focused,
      tabs: wg.tabs.map((t) => ({
        url: t.url,
        title: t.title,
        domain: t.domain,
        pinned: t.pinned,
        favIconUrl: t.favIconUrl,
        groupName: t.groupName,
      })),
    })),
    stats: {
      totalTabs,
      totalWindows: windowGroups.length,
      topDomains,
    },
  };

  try {
    try {
      await ensureServerPersistenceSync();
    } catch (error) {
      console.warn('Local persistence sync failed before saving snapshot:', error);
    }
    await fetchServerJson<{ snapshot: SnapshotRecord }>('/snapshots', {
      method: 'POST',
      body: JSON.stringify({
        snapshot,
        maxStoredSnapshots: settings.maxStoredSnapshots,
      }),
    });
  } catch {
    const snapshots = await getLocalSnapshots();
    snapshots.unshift(snapshot);
    if (snapshots.length > settings.maxStoredSnapshots) {
      snapshots.splice(settings.maxStoredSnapshots);
    }
    await saveLocalSnapshots(snapshots);
  }
  return snapshot;
}

async function deleteSnapshotRecord(id: string): Promise<void> {
  const localSnapshots = await getLocalSnapshots();
  const hadLocalCopy = localSnapshots.some((snapshot) => snapshot.id === id);

  if (hadLocalCopy) {
    await saveLocalSnapshots(localSnapshots.filter((snapshot) => snapshot.id !== id));
  }

  try {
    await fetchServerJson<{ deleted: boolean }>(`/snapshots/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch (error) {
    if (!hadLocalCopy) {
      throw error;
    }
  }
}

// ─── Settings ────────────────────────────────────────────

async function getLocalSettingsMirror(): Promise<UserSettings> {
  const result = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings ?? {}) } as UserSettings;
}

async function saveLocalSettingsMirror(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

async function getSettings(): Promise<UserSettings> {
  const local = await getLocalSettingsMirror();
  try {
    const data = await fetchServerJson<{ settings: UserSettings }>('/settings', {}, local.localServerUrl);
    const merged = { ...DEFAULT_SETTINGS, ...data.settings } as UserSettings;
    await saveLocalSettingsMirror(merged);
    return merged;
  } catch {
    return local;
  }
}

async function saveSettings(partial: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getLocalSettingsMirror();
  const updated = { ...current, ...partial } as UserSettings;
  await saveLocalSettingsMirror(updated);

  try {
    const data = await fetchServerJson<{ settings: UserSettings }>('/settings', {
      method: 'POST',
      body: JSON.stringify({ settings: updated }),
    }, updated.localServerUrl);
    const merged = { ...DEFAULT_SETTINGS, ...data.settings } as UserSettings;
    await saveLocalSettingsMirror(merged);
    return merged;
  } catch {
    // Keep the local mirror so the extension still boots even if the server is down.
    await chrome.storage.local.set({ settings: updated });
    return updated;
  }
}

async function getServerDbStatus(): Promise<ServerDbStatus> {
  const settings = await getSettings();
  const data = await fetchServerJson<{ status: ServerDbStatus }>('/db-status', {}, settings.localServerUrl);
  return data.status;
}

async function getServerRuntimeLogs(limit = 20): Promise<ServerRuntimeLogEntry[]> {
  const settings = await getSettings();
  const query = new URLSearchParams({ limit: String(limit) }).toString();
  const data = await fetchServerJson<{ logs: ServerRuntimeLogEntry[] }>(`/runtime-logs?${query}`, {}, settings.localServerUrl);
  return data.logs;
}

async function getLLMCallLogs(limit = 50, sessionTimestamp?: number, provider?: string): Promise<LLMCallLogEntry[]> {
  const settings = await getSettings();
  const params = new URLSearchParams({ limit: String(limit) });
  if (sessionTimestamp !== undefined) params.set('session_timestamp', String(sessionTimestamp));
  if (provider !== undefined) params.set('provider', provider);
  const data = await fetchServerJson<{ logs: LLMCallLogEntry[] }>(`/llm-call-logs?${params.toString()}`, {}, settings.localServerUrl);
  return data.logs;
}

async function getUrlCacheList(limit = 50, offset = 0, domain?: string, action?: string): Promise<{ entries: UrlCacheEntry[]; total: number }> {
  const settings = await getSettings();
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (domain) params.set('domain', domain);
  if (action) params.set('action', action);
  return fetchServerJson<{ entries: UrlCacheEntry[]; total: number }>(`/cache/urls?${params.toString()}`, {}, settings.localServerUrl);
}

async function deleteUrlCache(urls?: string[], domainPattern?: string): Promise<number> {
  const settings = await getSettings();
  const data = await fetchServerJson<{ deleted: number }>('/cache/urls', {
    method: 'DELETE',
    body: JSON.stringify({ urls, domainPattern }),
  }, settings.localServerUrl);
  return data.deleted;
}

async function getAnalysisSessions(limit = 50, offset = 0): Promise<AnalysisSessionEntry[]> {
  const settings = await getSettings();
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const data = await fetchServerJson<{ sessions: AnalysisSessionEntry[] }>(`/sessions?${params.toString()}`, {}, settings.localServerUrl);
  return data.sessions;
}

async function deleteAnalysisSession(sessionId: number): Promise<void> {
  const settings = await getSettings();
  await fetchServerJson<{ deleted: boolean }>(`/sessions/${sessionId}`, { method: 'DELETE' }, settings.localServerUrl);
}

async function getHabitsScore(): Promise<HabitsScore> {
  const settings = await getSettings();
  return fetchServerJson<HabitsScore>('/habits-score', {}, settings.localServerUrl);
}

async function trackRecommendation(action: RecommendationAction): Promise<void> {
  const settings = await getSettings();
  await fetchServerJson('/recommendation-actions', {
    method: 'POST',
    body: JSON.stringify({
      tabUrl: action.tabUrl,
      tabTitle: action.tabTitle,
      aiAction: action.aiAction,
      userAction: action.userAction,
      confidence: action.confidence,
    }),
  }, settings.localServerUrl);
}

async function getRecommendationStats(): Promise<RecommendationActionStats> {
  const settings = await getSettings();
  return fetchServerJson<RecommendationActionStats>('/recommendation-stats', {}, settings.localServerUrl);
}

async function getActivityHeatmap(domain?: string): Promise<ActivityHeatmapData> {
  const settings = await getSettings();
  const params = new URLSearchParams();
  if (domain) params.set('domain', domain);
  const query = params.toString();
  return fetchServerJson<ActivityHeatmapData>(`/activity-heatmap${query ? '?' + query : ''}`, {}, settings.localServerUrl);
}

async function getPersistentClusters(): Promise<PersistentCluster[]> {
  const settings = await getSettings();
  const data = await fetchServerJson<{ clusters: PersistentCluster[] }>('/clusters', {}, settings.localServerUrl);
  return data.clusters;
}

async function mergeAIClusters(clusters: { name: string; description: string; tags: string[]; tabUrls: string[] }[]): Promise<{ merged: number; created: number }> {
  const settings = await getSettings();
  return fetchServerJson<{ merged: number; created: number }>('/clusters/merge', {
    method: 'POST',
    body: JSON.stringify({ clusters }),
  }, settings.localServerUrl);
}

async function renameCluster(clusterId: number, name: string): Promise<void> {
  const settings = await getSettings();
  await fetchServerJson('/clusters/' + String(clusterId), {
    method: 'PUT',
    body: JSON.stringify({ name }),
  }, settings.localServerUrl);
}

async function deleteCluster(clusterId: number): Promise<void> {
  const settings = await getSettings();
  await fetchServerJson('/clusters/' + String(clusterId), {
    method: 'DELETE',
  }, settings.localServerUrl);
}

let focusGroupId: number | null = null;

async function getClusterTabMatches(clusterId: number): Promise<{ matchedTabIds: number[]; clusterName: string }> {
  const clusters = await getPersistentClusters();
  const cluster = clusters.find((c) => c.id === clusterId);
  if (!cluster) return { matchedTabIds: [], clusterName: '' };

  const clusterUrlSet = new Set(cluster.tabUrls.map((u) => u.toLowerCase()));
  const { windowGroups } = await getAllTabs();
  const allTabs = windowGroups.flatMap((wg) => wg.tabs);
  const matchedTabIds = allTabs
    .filter((tab) => clusterUrlSet.has(tab.url.toLowerCase()))
    .map((tab) => tab.id);

  return { matchedTabIds, clusterName: cluster.name };
}

async function focusOnCluster(clusterId: number): Promise<{ matchedTabIds: number[]; groupId: number | null; clusterName: string }> {
  if (focusGroupId !== null) {
    await exitFocusMode();
  }

  const { matchedTabIds, clusterName } = await getClusterTabMatches(clusterId);
  let groupId: number | null = null;

  if (matchedTabIds.length > 0) {
    groupId = await chrome.tabs.group({ tabIds: matchedTabIds as [number, ...number[]] });
    await chrome.tabGroups.update(groupId, { title: clusterName, color: 'cyan', collapsed: false });
    focusGroupId = groupId;

    // Collapse other tab groups
    const allGroups = await chrome.tabGroups.query({});
    for (const g of allGroups) {
      if (g.id !== groupId) {
        await chrome.tabGroups.update(g.id, { collapsed: true });
      }
    }
  }

  return { matchedTabIds, groupId, clusterName };
}

async function exitFocusMode(): Promise<void> {
  if (focusGroupId !== null) {
    try {
      const tabs = await chrome.tabs.query({ groupId: focusGroupId });
      if (tabs.length > 0) {
        const tabIds = tabs.map((t) => t.id).filter((id): id is number => id !== undefined);
        if (tabIds.length > 0) {
          await chrome.tabs.ungroup(tabIds as [number, ...number[]]);
        }
      }
    } catch {
      // group may already be gone
    }
    // Uncollapse all groups
    const allGroups = await chrome.tabGroups.query({});
    for (const g of allGroups) {
      await chrome.tabGroups.update(g.id, { collapsed: false });
    }
    focusGroupId = null;
  }
}

async function groupTabsByCluster(tabIds: number[], name: string, color?: string): Promise<void> {
  if (tabIds.length === 0) return;
  const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] });
  const updateProps: chrome.tabGroups.UpdateProperties = { title: name };
  if (color) {
    const validColors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
    type TabGroupColor = typeof validColors[number];
    if (validColors.includes(color as TabGroupColor)) {
      updateProps.color = color as TabGroupColor;
    }
  }
  await chrome.tabGroups.update(groupId, updateProps);
}

async function getTabInsights(): Promise<TabInsights> {
  const settings = await getSettings();
  return fetchServerJson<TabInsights>('/insights', {}, settings.localServerUrl);
}

async function syncServerPersistenceNow(): Promise<void> {
  const localSettings = await getLocalSettingsMirror();
  const data = await fetchServerJson<{ settings: UserSettings }>('/settings', {
    method: 'POST',
    body: JSON.stringify({ settings: localSettings }),
  }, localSettings.localServerUrl);
  await saveLocalSettingsMirror({ ...DEFAULT_SETTINGS, ...data.settings });
  await ensureServerPersistenceSync();
}

async function clearServerDatabase(): Promise<ServerDbStatus> {
  const settings = await getSettings();
  const data = await fetchServerJson<{ status: ServerDbStatus }>('/db/clear', {
    method: 'POST',
    body: JSON.stringify({ preserveSettings: true }),
  }, settings.localServerUrl);

  await chrome.storage.local.remove(['snapshots', 'tabHistory', 'lastAIResult']);
  broadcast({ type: 'HISTORY_UPDATED' });
  return data.status;
}

// ─── User Flags ──────────────────────────────────────────

async function getUserFlags(): Promise<Record<number, TabRecord['userFlag']>> {
  const result = await chrome.storage.local.get('userFlags');
  return (result.userFlags ?? {}) as Record<number, TabRecord['userFlag']>;
}

async function setUserFlag(tabId: number, flag: TabRecord['userFlag'] | null): Promise<void> {
  const flags = await getUserFlags();
  if (flag === null) {
    delete flags[tabId];
  } else {
    flags[tabId] = flag;
  }
  await chrome.storage.local.set({ userFlags: flags });
}

// ─── Tab History ─────────────────────────────────────────

async function logTabEvent(
  tabId: number,
  url: string,
  title: string,
  domain: string,
  event: TabHistoryEntry['event']
): Promise<void> {
  if (!isTrackableHistoryUrl(url)) return;

  await queueHistoryMutation(async () => {
    const entry: TabHistoryEntry = { tabId, url, title, domain, event, timestamp: Date.now() };
    try {
      await fetchServerJson('/tab-history/events', {
        method: 'POST',
        body: JSON.stringify(entry),
      });
    } catch {
      const history = await getLocalHistoryEntries();
      history.push(entry);
      await saveLocalHistoryEntries(history);
    }
  });

  broadcast({ type: 'HISTORY_UPDATED' });
}

function getTimeframeCutoff(timeframe: HistoryTimeframe): number {
  const now = Date.now();
  const MS_PER_DAY = 86_400_000;
  switch (timeframe) {
    case 'day': return now - MS_PER_DAY;
    case 'week': return now - 7 * MS_PER_DAY;
    case 'month': return now - 30 * MS_PER_DAY;
  }
}

async function buildHistoryStatsFromEntries(history: TabHistoryEntry[], timeframe: HistoryTimeframe): Promise<TabHistoryStats[]> {
  const cutoff = getTimeframeCutoff(timeframe);
  const filtered = history.filter((e) => e.timestamp >= cutoff);
  const lastOpenedByUrl = new Map<string, number>();

  for (const entry of history) {
    if (entry.event !== 'opened') continue;
    const previous = lastOpenedByUrl.get(entry.url) ?? 0;
    if (entry.timestamp > previous) {
      lastOpenedByUrl.set(entry.url, entry.timestamp);
    }
  }

  // Group by URL and compute stats
  const statsMap = new Map<string, TabHistoryStats>();
  for (const entry of filtered) {
    const existing = statsMap.get(entry.url);
    if (existing) {
      if (entry.event === 'activated') existing.activationCount++;
      if (entry.timestamp < existing.firstSeen) existing.firstSeen = entry.timestamp;
      if (entry.timestamp > existing.lastSeen) {
        existing.lastSeen = entry.timestamp;
        existing.title = entry.title;
      }
    } else {
      statsMap.set(entry.url, {
        url: entry.url,
        title: entry.title,
        domain: entry.domain,
        activationCount: entry.event === 'activated' ? 1 : 0,
        firstSeen: entry.timestamp,
        lastSeen: entry.timestamp,
        lastOpenedAt: lastOpenedByUrl.get(entry.url) ?? (entry.event === 'opened' ? entry.timestamp : null),
        stillOpen: false,
      });
    }
  }

  return markStillOpen([...statsMap.values()].sort((a, b) => b.lastSeen - a.lastSeen));
}

async function markStillOpen(stats: TabHistoryStats[]): Promise<TabHistoryStats[]> {
  const currentTabs = await chrome.tabs.query({});
  const openUrls = new Set(currentTabs.map((tab) => tab.url));

  for (const item of stats) {
    item.stillOpen = openUrls.has(item.url);
  }

  return stats;
}

async function getTabHistory(timeframe: HistoryTimeframe, limit = 0, offset = 0): Promise<{ stats: TabHistoryStats[]; total: number }> {
  try {
    const params = new URLSearchParams({ timeframe });
    if (limit > 0) {
      params.set('limit', String(limit));
      params.set('offset', String(offset));
    }
    const data = await fetchServerJson<{ stats: Omit<TabHistoryStats, 'stillOpen'>[]; total: number }>(`/tab-history?${params.toString()}`);
    return { stats: await markStillOpen(data.stats.map((item) => ({ ...item, stillOpen: false }))), total: data.total };
  } catch {
    const history = await getLocalHistoryEntries();
    const stats = await buildHistoryStatsFromEntries(history, timeframe);
    return { stats, total: stats.length };
  }
}

async function cleanupOldHistory(): Promise<void> {
  const settings = await getSettings();
  const cutoff = Date.now() - settings.historyRetentionDays * 86_400_000;
  let didPrune = false;

  await queueHistoryMutation(async () => {
    const history = await getLocalHistoryEntries();
    const pruned = history.filter((e) => e.timestamp >= cutoff);
    if (pruned.length !== history.length) {
      await saveLocalHistoryEntries(pruned);
      didPrune = true;
    }

    try {
      const response = await fetchServerJson<{ deleted: number }>('/tab-history/prune', {
        method: 'POST',
        body: JSON.stringify({ retentionDays: settings.historyRetentionDays }),
      }, settings.localServerUrl);
      if (response.deleted > 0) {
        didPrune = true;
      }
    } catch {
      // Keep local backup and retry on the next sync.
    }
  });

  if (didPrune) {
    broadcast({ type: 'HISTORY_UPDATED' });
  }
}

// ─── AI Analysis ─────────────────────────────────────────

function computeTabFingerprint(urls: string[]): string {
  const sorted = [...urls].sort();
  const str = sorted.join('\n');
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

interface ServerCacheStats {
  totalTabs: number;
  tabsFromCache: number;
  tabsAnalyzed: number;
  tabsSaved: number;
  cacheHitRate: number;
}

interface ServerAnalyzeResponse {
  result: AIAnalysisResult;
  metadata: AIAnalysisMetadata;
  cacheStats: ServerCacheStats;
}

type AnalysisRunStatus = 'running' | 'stopped' | 'completed' | 'failed';
type PersistedRunTab = AISessionInput['tabs'][number];

interface ServerAnalysisRunSnapshot {
  id: string;
  fingerprint: string;
  status: AnalysisRunStatus;
  phase: AIProgress['phase'] | 'completed' | 'failed';
  startedAt: number;
  updatedAt: number;
  analyzedAt: number | null;
  forceRefresh: boolean;
  totalTabs: number;
  tabsCached: number;
  tabsAnalyzed: number;
  tabsProcessed: number;
  tabsRemaining: number;
  tabsSaved: number;
  batchesTotal: number;
  batchesCompleted: number;
  currentBatch: number;
  providerOrderOverride: AIProviderId[];
  fallbackNotice: string | null;
  result: AIAnalysisResult;
  metadata: AIAnalysisMetadata;
  allTabs: PersistedRunTab[];
  pendingTabs: PersistedRunTab[];
  tabStatuses: TabAnalysisStatus[];
  error: string | null;
}

function getProviderModel(
  provider: UserSettings['serverAiProvider'] | UserSettings['fallbackAiProvider'],
  settings: UserSettings,
): string | null {
  if (provider === 'codex_cli') {
    const model = settings.codexModel.trim();
    return model || null;
  }
  return null;
}

function createProviderRuntimeStatus(settings: UserSettings): AIProviderRuntimeStatus {
  const currentProvider = settings.serverAiProvider === 'none' ? null : settings.serverAiProvider;
  return {
    primaryProvider: settings.serverAiProvider,
    fallbackProvider: settings.fallbackAiProvider,
    currentProvider,
    currentModel: currentProvider ? getProviderModel(currentProvider, settings) : null,
    attempts: [],
    lastError: null,
    servedFromCacheOnly: false,
  };
}

function mergeProviderRuntimeStatus(
  current: AIProviderRuntimeStatus,
  metadata: AIAnalysisMetadata,
  settings: UserSettings,
): AIProviderRuntimeStatus {
  const incomingAttempts = metadata.providerAttempts ?? [];
  const next: AIProviderRuntimeStatus = {
    ...current,
    attempts: [...current.attempts, ...incomingAttempts],
    lastError: current.lastError,
    servedFromCacheOnly: false,
  };

  const successfulAttempt = [...incomingAttempts]
    .reverse()
    .find((attempt) => attempt.status === 'succeeded');
  if (successfulAttempt) {
    next.currentProvider = successfulAttempt.provider;
    next.currentModel = successfulAttempt.model ?? getProviderModel(successfulAttempt.provider, settings);
    next.lastError = null;
    return next;
  }

  const failedAttempt = [...incomingAttempts]
    .reverse()
    .find((attempt) => attempt.status === 'failed');
  if (failedAttempt) {
    next.currentProvider = failedAttempt.provider;
    next.currentModel = failedAttempt.model ?? getProviderModel(failedAttempt.provider, settings);
    next.lastError = failedAttempt.error ?? current.lastError;
  }

  return next;
}

function shouldStickToFallback(attempts: AIProviderAttempt[]): AIProviderId | null {
  const successfulAttempt = [...attempts]
    .reverse()
    .find((attempt) => attempt.status === 'succeeded');
  if (!successfulAttempt) {
    return null;
  }

  const failedAttempt = attempts.find((attempt) => attempt.status === 'failed');
  if (!failedAttempt) {
    return null;
  }

  return successfulAttempt.provider !== failedAttempt.provider
    ? successfulAttempt.provider
    : null;
}

function buildClientFallbackRecommendations(
  tabs: TabRecord[],
  staleDaysThreshold: number,
  reasonPrefix: string,
): TabRecommendation[] {
  const { tabs: ruledTabs } = runRules(tabs, staleDaysThreshold);
  const domainCounts = new Map<string, number>();

  for (const tab of ruledTabs) {
    domainCounts.set(tab.domain, (domainCounts.get(tab.domain) ?? 0) + 1);
  }

  return ruledTabs.map((tab) => {
    if (tab.pinned || tab.active) {
      return {
        tabId: tab.id,
        action: 'keep',
        confidence: 0.98,
        reason: `${reasonPrefix} Kept because the tab is pinned or active.`,
      };
    }

    if (tab.ruleFlags?.isExactDuplicate) {
      return {
        tabId: tab.id,
        action: 'close',
        confidence: 0.92,
        reason: `${reasonPrefix} Looks like a duplicate of another open tab.`,
      };
    }

    if (tab.ruleFlags?.isStale) {
      return {
        tabId: tab.id,
        action: 'read_later',
        confidence: 0.78,
        reason: `${reasonPrefix} This tab looks stale and is a good candidate for reading later.`,
      };
    }

    if (tab.ruleFlags?.isNearDuplicate || (domainCounts.get(tab.domain) ?? 0) >= 3) {
      return {
        tabId: tab.id,
        action: 'group',
        confidence: 0.72,
        reason: `${reasonPrefix} Similar tabs from the same topic can be grouped.`,
        suggestedGroupName: tab.groupName || tab.domain,
      };
    }

    return {
      tabId: tab.id,
      action: 'keep',
      confidence: 0.58,
      reason: `${reasonPrefix} No strong cleanup signal was found for this tab.`,
    };
  });
}

function summarizeBatchTransportIssue(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : String(error).trim();
  const lowered = message.toLowerCase();

  if (lowered.includes('timed out')) {
    return 'The local AI batch request timed out, so heuristic recommendations were used for this batch.';
  }

  if (lowered.includes('could not connect to ai server')) {
    return 'The local AI server was unreachable, so heuristic recommendations were used for this batch.';
  }

  return 'The local AI batch failed before a response arrived, so heuristic recommendations were used for this batch.';
}

function normalizeServerUrl(serverUrl: string): URL {
  const trimmed = serverUrl.trim();
  if (!trimmed) {
    throw new Error('AI server URL is empty. Check Settings.');
  }

  try {
    const url = new URL(trimmed);
    if (!url.protocol.startsWith('http')) {
      throw new Error('AI server URL must use http or https.');
    }
    if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`;
    }
    return url;
  } catch {
    throw new Error(`Invalid AI server URL: ${trimmed}`);
  }
}

function buildServerEndpointCandidates(serverUrl: string, endpoint: string): string[] {
  const base = normalizeServerUrl(serverUrl);
  const target = new URL(endpoint, base);
  const hosts = [base.hostname];

  if (base.hostname === 'localhost') {
    hosts.push('127.0.0.1');
  } else if (base.hostname === '127.0.0.1' || base.hostname === '[::1]') {
    hosts.push('localhost');
  }

  return [...new Set(hosts)].map((hostname) => {
    const candidate = new URL(target.toString());
    candidate.hostname = hostname;
    return candidate.toString();
  });
}

async function fetchLocalServer(
  serverUrl: string,
  endpoint: string,
  init: RequestInit,
): Promise<Response> {
  const candidates = buildServerEndpointCandidates(serverUrl, endpoint);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      return await fetch(candidate, init);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error && lastError.message
    ? ` Last error: ${lastError.message}`
    : '';
  throw new Error(`Could not connect to AI server at ${serverUrl}. Make sure "pnpm server" is running.${suffix}`);
}

async function fetchLocalServerWithTimeout(
  serverUrl: string,
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const timeoutController = new AbortController();
  const originalSignal = init.signal;
  let timedOut = false;

  const propagateAbort = () => {
    timeoutController.abort(originalSignal?.reason);
  };

  if (originalSignal) {
    if (originalSignal.aborted) {
      propagateAbort();
    } else {
      originalSignal.addEventListener('abort', propagateAbort, { once: true });
    }
  }

  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    timeoutController.abort(
      new DOMException(
        `AI batch request timed out after ${Math.round(timeoutMs / 1000)}s`,
        'TimeoutError',
      ),
    );
  }, timeoutMs);

  try {
    return await fetchLocalServer(serverUrl, endpoint, {
      ...init,
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(`AI batch request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    if (originalSignal) {
      originalSignal.removeEventListener('abort', propagateAbort);
    }
  }
}

async function fetchServerJson<T>(
  endpoint: string,
  init: RequestInit = {},
  serverUrl?: string,
): Promise<T> {
  const resolvedServerUrl = serverUrl ?? (await getSettings()).localServerUrl;
  const headers = new Headers(init.headers ?? undefined);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetchLocalServer(resolvedServerUrl, endpoint, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const detail = await readServerError(response);
    throw new Error(
      detail
        ? `Local server responded with ${response.status}: ${detail}`
        : `Local server responded with ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

async function readServerError(response: Response): Promise<string | null> {
  try {
    const data = (await response.clone().json()) as { detail?: unknown };
    if (typeof data.detail === 'string' && data.detail.trim()) {
      return data.detail.trim();
    }
    if (data.detail !== undefined) {
      return JSON.stringify(data.detail);
    }
  } catch {
    // Ignore JSON parsing errors and fall back to plain text.
  }

  try {
    const text = (await response.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

function createProgressFromRun(snapshot: ServerAnalysisRunSnapshot): AIProgress {
  const phase = snapshot.status === 'stopped'
    ? 'stopped'
    : snapshot.phase === 'completed' || snapshot.phase === 'failed'
      ? 'processing'
      : snapshot.phase;

  return {
    phase,
    tabsTotal: snapshot.totalTabs,
    tabsCached: snapshot.tabsCached,
    tabsNew: Math.max(snapshot.totalTabs - snapshot.tabsCached, 0),
    tabsAnalyzed: snapshot.tabsAnalyzed,
    tabsProcessed: snapshot.tabsProcessed,
    tabsRemaining: snapshot.tabsRemaining,
    tabsSaved: snapshot.tabsSaved,
    batchesTotal: snapshot.batchesTotal,
    batchesCompleted: snapshot.batchesCompleted,
    currentBatch: snapshot.currentBatch,
    startedAt: snapshot.startedAt,
    providerStatus: snapshot.metadata.providerStatus,
  };
}

function summarizeTabStatuses(statuses: TabAnalysisStatus[]): TabAnalysisStatusSummary {
  return statuses.reduce<TabAnalysisStatusSummary>((summary, status) => {
    summary.total += 1;
    if (status.status === 'cached') {
      summary.cached += 1;
    } else if (status.status === 'analyzed') {
      summary.analyzed += 1;
    } else if (status.status === 'failed') {
      summary.failed += 1;
    } else {
      summary.pending += 1;
    }
    return summary;
  }, {
    total: 0,
    cached: 0,
    analyzed: 0,
    pending: 0,
    failed: 0,
  });
}

function splitIntoBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

const THEME_QUERY_KEYS = ['q', 'query', 'search', 'text', 'title', 'topic', 's'] as const;
const THEME_STOPWORDS = new Set([
  'about', 'account', 'accounts', 'agent', 'agents', 'all', 'and', 'app', 'article',
  'assistant', 'auth', 'blog', 'browser', 'chat', 'chrome', 'code', 'codex', 'com',
  'course', 'courses', 'dashboard', 'default', 'demo', 'docs', 'document', 'download',
  'edu', 'en', 'error', 'extensions', 'for', 'free', 'from', 'github', 'google', 'help',
  'home', 'how', 'http', 'https', 'index', 'info', 'latest', 'learn', 'lesson', 'lessons',
  'list', 'localhost', 'login', 'mail', 'main', 'manage', 'menu', 'net', 'new', 'news',
  'notes', 'open', 'optimizer', 'org', 'page', 'pages', 'platform', 'post', 'pricing',
  'product', 'products', 'profile', 'project', 'projects', 'read', 'ref', 'results',
  'review', 'ru', 'search', 'service', 'settings', 'sign', 'site', 'start', 'support',
  'tab', 'tabs', 'team', 'teams', 'the', 'this', 'today', 'tool', 'tools', 'topic',
  'update', 'user', 'users', 'video', 'watch', 'web', 'what', 'why', 'with', 'work',
  'www', 'xcom', 'youtube', 'your', 'данные', 'для', 'или', 'как', 'курс', 'курсы',
  'модель', 'модели', 'новое', 'новый', 'обзор', 'онлайн', 'подборка', 'посмотреть',
  'после', 'проект', 'работа', 'страница', 'статья', 'темы', 'урок', 'уроки',
  'что', 'это', 'этот', 'эти',
]);

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeThemeToken(token: string): string | null {
  const normalized = token.trim().replace(/^[_+.#-]+|[_+.#-]+$/g, '').toLowerCase();
  if (normalized.length < 3) return null;
  if (/^\d+$/.test(normalized)) return null;
  if (THEME_STOPWORDS.has(normalized)) return null;
  return normalized;
}

function tokenizeThemeText(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    .replace(/[^0-9a-zA-Z\u0400-\u04FF]+/g, ' ')
    .trim();

  if (!cleaned) return [];

  return dedupeStrings(
    cleaned
      .split(/\s+/)
      .map((part) => normalizeThemeToken(part))
      .filter((token): token is string => Boolean(token)),
  );
}

function extractThemeTokens(tab: Pick<TabRecord, 'title' | 'url' | 'domain' | 'groupName'>): string[] {
  const parts = [tab.title, tab.groupName ?? ''];
  try {
    const parsed = new URL(tab.url);
    parts.push(decodeURIComponent(parsed.pathname).replace(/\//g, ' '));
    for (const key of THEME_QUERY_KEYS) {
      const value = parsed.searchParams.get(key);
      if (value) {
        parts.push(decodeURIComponent(value));
      }
    }
  } catch {}

  const tokens: string[] = [];
  for (const part of parts) {
    tokens.push(...tokenizeThemeText(part));
  }
  return dedupeStrings(tokens);
}

function formatThemeName(tokens: string[]): string {
  if (tokens.length === 0) return 'Mixed Topic';
  return tokens
    .slice(0, 2)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function buildThemeClusters(allTabs: TabRecord[]): TopicCluster[] {
  if (allTabs.length < 2) return [];

  const tokenMap = new Map<number, string[]>();
  const docFrequency = new Map<string, number>();
  for (const tab of allTabs) {
    const tokens = extractThemeTokens(tab);
    tokenMap.set(tab.id, tokens);
    for (const token of new Set(tokens)) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }

  const maxCommonFrequency = Math.max(6, Math.floor(allTabs.length * 0.45));
  const sharedTokenMap = new Map<number, string[]>();
  for (const tab of allTabs) {
    const filtered = (tokenMap.get(tab.id) ?? [])
      .filter((token) => {
        const frequency = docFrequency.get(token) ?? 0;
        return frequency >= 2 && frequency <= maxCommonFrequency;
      })
      .slice(0, 8);
    sharedTokenMap.set(tab.id, filtered);
  }

  const draftClusters: Array<{
    tabs: TabRecord[];
    tokenCounts: Map<string, number>;
  }> = [];

  for (const tab of [...allTabs].sort((left, right) => {
    return (sharedTokenMap.get(right.id)?.length ?? 0) - (sharedTokenMap.get(left.id)?.length ?? 0);
  })) {
    const tokens = sharedTokenMap.get(tab.id) ?? [];
    if (tokens.length === 0) continue;

    const tokenSet = new Set(tokens);
    let bestIndex: number | null = null;
    let bestScore = 0;

    draftClusters.forEach((cluster, index) => {
      const clusterKeywords = [...cluster.tokenCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 6)
        .map(([token]) => token);
      const overlap = clusterKeywords.filter((token) => tokenSet.has(token));
      if (overlap.length === 0) return;

      const topOverlapFrequency = Math.max(...overlap.map((token) => docFrequency.get(token) ?? 0));
      if (
        overlap.length > bestScore
        && (overlap.length >= 2 || topOverlapFrequency <= Math.max(4, Math.floor(allTabs.length / 6) || 1))
      ) {
        bestIndex = index;
        bestScore = overlap.length;
      }
    });

    if (bestIndex === null) {
      draftClusters.push({
        tabs: [tab],
        tokenCounts: new Map(tokens.map((token) => [token, 1])),
      });
      continue;
    }

    const cluster = draftClusters[bestIndex];
    if (!cluster.tabs.some((existing) => existing.id === tab.id)) {
      cluster.tabs.push(tab);
    }
    for (const token of tokens) {
      cluster.tokenCounts.set(token, (cluster.tokenCounts.get(token) ?? 0) + 1);
    }
  }

  const signatures = new Set<string>();
  return draftClusters
    .filter((cluster) => cluster.tabs.length >= 2)
    .map((cluster) => {
      const keywords = [...cluster.tokenCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 4)
        .map(([token]) => token);
      return {
        name: formatThemeName(keywords),
        tabIds: cluster.tabs.map((tab) => tab.id),
        tabUrls: cluster.tabs.map((tab) => tab.url),
        description: `${cluster.tabs.length} tabs around ${keywords.slice(0, 3).join(', ')}`,
        tags: keywords,
      };
    })
    .filter((cluster) => {
      const signature = `${cluster.name.toLowerCase()}::${cluster.tabIds.slice().sort((left, right) => left - right).join(',')}`;
      if (signatures.has(signature)) return false;
      signatures.add(signature);
      return true;
    })
    .sort((left, right) => right.tabIds.length - left.tabIds.length || left.name.localeCompare(right.name))
    .slice(0, 15);
}

function buildMainThemes(allTabs: TabRecord[], topicClusters: TopicCluster[]): string[] {
  if (topicClusters.length > 0) {
    return topicClusters.slice(0, 5).map((cluster) => cluster.name);
  }

  const docFrequency = new Map<string, number>();
  for (const tab of allTabs) {
    for (const token of new Set(extractThemeTokens(tab))) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }

  return [...docFrequency.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([token]) => formatThemeName([token]));
}

function buildAggregatedResult(
  allTabs: TabRecord[],
  recommendations: TabRecommendation[],
  fallbackNotice?: string,
  totalTabsOverride?: number,
): AIAnalysisResult {
  const topicClusters = buildThemeClusters(allTabs);

  const actionBreakdown: Partial<Record<RecommendedAction, number>> = {};
  for (const rec of recommendations) {
    actionBreakdown[rec.action] = (actionBreakdown[rec.action] ?? 0) + 1;
  }

  const closable = actionBreakdown.close ?? 0;
  const mainThemes = buildMainThemes(allTabs, topicClusters);

  const expectedTotal = totalTabsOverride ?? allTabs.length;
  const parts: string[] = [];
  if (closable > 0) parts.push(`${closable} close`);
  if (actionBreakdown.archive) parts.push(`${actionBreakdown.archive} archive`);
  if (actionBreakdown.read_later) parts.push(`${actionBreakdown.read_later} read later`);
  if (actionBreakdown.group) parts.push(`${actionBreakdown.group} group`);
  if (actionBreakdown.keep) parts.push(`${actionBreakdown.keep} keep`);

  const breakdown = parts.length > 0 ? `: ${parts.join(', ')}` : '';

  const summaryBase = allTabs.length === expectedTotal
    ? `Analyzed ${allTabs.length} tabs${breakdown}.`
    : `Processed ${allTabs.length} of ${expectedTotal} tabs${breakdown}.`;

  return {
    summary: fallbackNotice ? `${fallbackNotice} ${summaryBase}` : summaryBase,
    topicClusters,
    tabRecommendations: recommendations,
    duplicateGroups: [],
    staleTabIds: [],
    sessionStats: {
      estimatedClosable: closable,
      mainThemes,
      urgentItems: 0,
      actionBreakdown,
    },
  };
}

function toPersistedRunTabs(tabs: TabRecord[]): PersistedRunTab[] {
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    domain: tab.domain,
    pinned: tab.pinned,
    active: tab.active,
    groupId: tab.groupId,
    groupName: tab.groupName,
  }));
}

function toSessionTabs(tabs: TabRecord[]): AISessionInput['tabs'] {
  return toPersistedRunTabs(tabs);
}

function toTabRecords(tabs: PersistedRunTab[]): TabRecord[] {
  return tabs.map((tab, index) => ({
    id: tab.id,
    windowId: 0,
    index,
    url: tab.url,
    title: tab.title,
    domain: tab.domain,
    pinned: tab.pinned,
    active: tab.active,
    groupId: tab.groupId,
    groupName: tab.groupName,
  }));
}

function buildRecommendationFromStatus(status: TabAnalysisStatus): TabRecommendation | null {
  if (!status.action || status.confidence == null || !status.reason) {
    return null;
  }

  return {
    tabId: status.tabId,
    action: status.action,
    confidence: status.confidence,
    reason: status.reason,
    suggestedGroupName: status.suggestedGroupName ?? undefined,
  };
}

function updateStatusesForBatch(
  statuses: TabAnalysisStatus[],
  batch: TabRecord[],
  recommendations: TabRecommendation[],
  metadata: AIAnalysisMetadata,
  analyzedAt: number,
  sourceOverride?: TabAnalysisStatus['source'],
): TabAnalysisStatus[] {
  const batchIds = new Set(batch.map((tab) => tab.id));
  const recommendationMap = new Map(recommendations.map((recommendation) => [recommendation.tabId, recommendation]));
  const providerSucceeded = (metadata.providerAttempts ?? []).some((attempt) => attempt.status === 'succeeded');
  const source = sourceOverride ?? (providerSucceeded ? 'provider' : 'heuristic');
  const provider = source === 'provider' ? (metadata.providerUsed ?? null) : null;
  const model = source === 'provider' ? (metadata.modelUsed ?? null) : null;

  return statuses.map((status) => {
    if (!batchIds.has(status.tabId)) {
      return status;
    }

    const recommendation = recommendationMap.get(status.tabId);
    if (!recommendation) {
      return {
        ...status,
        status: 'failed',
        source,
        analyzedAt,
        provider,
        model,
      };
    }

    return {
      ...status,
      status: 'analyzed',
      source,
      action: recommendation.action,
      confidence: recommendation.confidence,
      reason: recommendation.reason,
      suggestedGroupName: recommendation.suggestedGroupName,
      analyzedAt,
      provider,
      model,
    };
  });
}

function createInitialAnalysisRunSnapshot(
  allTabs: TabRecord[],
  pendingTabs: TabRecord[],
  initialStatuses: TabAnalysisStatus[],
  forceRefresh: boolean,
  providerStatus: AIProviderRuntimeStatus,
): ServerAnalysisRunSnapshot {
  const persistedTabs = toPersistedRunTabs(allTabs);
  const fingerprint = computeTabFingerprint(allTabs.map((tab) => tab.url));
  const startedAt = Date.now();
  const readyRecommendations = initialStatuses
    .map((status) => buildRecommendationFromStatus(status))
    .filter((recommendation): recommendation is TabRecommendation => recommendation !== null);
  const readyIds = new Set(readyRecommendations.map((recommendation) => recommendation.tabId));
  const readyTabs = allTabs.filter((tab) => readyIds.has(tab.id));
  const summary = summarizeTabStatuses(initialStatuses);
  const initialResult = buildAggregatedResult(readyTabs, readyRecommendations, undefined, allTabs.length);

  return {
    id: uuid(),
    fingerprint,
    status: 'running',
    phase: 'sending',
    startedAt,
    updatedAt: startedAt,
    analyzedAt: null,
    forceRefresh,
    totalTabs: allTabs.length,
    tabsCached: summary.cached,
    tabsAnalyzed: 0,
    tabsProcessed: summary.cached,
    tabsRemaining: pendingTabs.length,
    tabsSaved: 0,
    batchesTotal: splitIntoBatches(pendingTabs, ANALYSIS_BATCH_SIZE).length,
    batchesCompleted: 0,
    currentBatch: pendingTabs.length > 0 ? 1 : 0,
    providerOrderOverride: [],
    fallbackNotice: null,
    result: initialResult,
    metadata: {
      durationMs: 0,
      durationApiMs: 0,
      totalCostUsd: null,
      inputTokens: 0,
      outputTokens: 0,
      tabCount: allTabs.length,
      providerAttempts: [],
      providerStatus,
    },
    allTabs: persistedTabs,
    pendingTabs: toPersistedRunTabs(pendingTabs),
    tabStatuses: initialStatuses,
    error: null,
  };
}

async function fetchTabAnalysisStatus(
  tabs: TabRecord[],
  serverUrl: string,
  forceRefresh = false,
): Promise<GetTabAnalysisStatusResponse['data']> {
  return fetchServerJson<GetTabAnalysisStatusResponse['data']>(
    '/tab-analysis-status',
    {
      method: 'POST',
      body: JSON.stringify({
        tabs: toSessionTabs(tabs),
        forceRefresh,
      }),
    },
    serverUrl,
  );
}

async function importUrlAnalysesToServer(
  tabs: TabRecord[],
  recommendations: TabRecommendation[],
  metadata: AIAnalysisMetadata,
  analyzedAt: number,
  serverUrl: string,
  analysisSource: 'provider' | 'heuristic',
): Promise<number> {
  if (tabs.length === 0 || recommendations.length === 0) {
    return 0;
  }

  const data = await fetchServerJson<{ saved: number }>(
    '/url-analysis/import',
    {
      method: 'POST',
      body: JSON.stringify({
        tabs: toSessionTabs(tabs),
        recommendations,
        analysisSource,
        provider: metadata.providerUsed ?? null,
        model: metadata.modelUsed ?? null,
        analyzedAt,
      }),
    },
    serverUrl,
  );
  return data.saved;
}

async function createServerAnalysisRun(snapshot: ServerAnalysisRunSnapshot, serverUrl: string): Promise<ServerAnalysisRunSnapshot> {
  const data = await fetchServerJson<{ run: ServerAnalysisRunSnapshot }>(
    '/analysis-runs',
    {
      method: 'POST',
      body: JSON.stringify({ snapshot }),
    },
    serverUrl,
  );
  return data.run;
}

async function updateServerAnalysisRun(snapshot: ServerAnalysisRunSnapshot, serverUrl: string): Promise<ServerAnalysisRunSnapshot> {
  const data = await fetchServerJson<{ run: ServerAnalysisRunSnapshot }>(
    `/analysis-runs/${snapshot.id}`,
    {
      method: 'PUT',
      body: JSON.stringify({ snapshot }),
    },
    serverUrl,
  );
  return data.run;
}

async function getLatestServerAnalysisRun(serverUrl: string, fingerprint?: string): Promise<ServerAnalysisRunSnapshot | null> {
  const query = fingerprint ? `?fingerprint=${encodeURIComponent(fingerprint)}` : '';
  try {
    const data = await fetchServerJson<{ run: ServerAnalysisRunSnapshot }>(
      `/analysis-runs/latest${query}`,
      {},
      serverUrl,
    );
    return data.run;
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

async function persistLocalAiResult(snapshot: ServerAnalysisRunSnapshot): Promise<void> {
  const cached: CachedAIResult = {
    result: snapshot.result,
    analyzedAt: snapshot.analyzedAt ?? snapshot.updatedAt,
    metadata: snapshot.metadata,
    fingerprint: snapshot.fingerprint,
  };
  await chrome.storage.local.set({ lastAIResult: cached });
}

async function analyzeTabsViaServer(forceRefresh = false, resume = false): Promise<void> {
  const runToken = ++currentAnalysisRunId;
  const controller = new AbortController();
  currentAnalysisController = controller;

  let snapshot: ServerAnalysisRunSnapshot | null = null;
  let settings: UserSettings | null = null;

  try {
    const { windowGroups } = await getAllTabs();
    const currentTabs = windowGroups.flatMap((wg) => wg.tabs);
    const fingerprint = computeTabFingerprint(currentTabs.map((tab) => tab.url));
    settings = await getSettings();

    if (resume) {
      const latestRun = await getLatestServerAnalysisRun(settings.localServerUrl, fingerprint);
      if (!latestRun || latestRun.pendingTabs.length === 0 || latestRun.status === 'completed') {
        throw new Error('No resumable analysis state was found for the current tabs.');
      }
      snapshot = {
        ...latestRun,
        status: 'running',
        phase: 'sending',
        updatedAt: Date.now(),
        error: null,
      };
      snapshot = await updateServerAnalysisRun(snapshot, settings.localServerUrl);
    } else {
      const providerStatus = createProviderRuntimeStatus(settings);
      const statusData = await fetchTabAnalysisStatus(currentTabs, settings.localServerUrl, forceRefresh);
      const pendingTabIds = new Set(
        statusData.statuses
          .filter((status) => status.status !== 'cached')
          .map((status) => status.tabId),
      );
      const pendingCurrentTabs = currentTabs.filter((tab) => pendingTabIds.has(tab.id));
      snapshot = createInitialAnalysisRunSnapshot(
        currentTabs,
        pendingCurrentTabs,
        statusData.statuses,
        forceRefresh,
        providerStatus,
      );
      snapshot = await createServerAnalysisRun(snapshot, settings.localServerUrl);
    }

    const initialProgress = createProgressFromRun(snapshot);
    const initialStatusSummary = summarizeTabStatuses(snapshot.tabStatuses);
    broadcast({
      type: 'AI_ANALYSIS_PROGRESS',
      progress: initialProgress,
    });
    if (snapshot.result.tabRecommendations.length > 0 || snapshot.tabStatuses.length > 0) {
      broadcast({
        type: 'AI_ANALYSIS_PARTIAL',
        result: snapshot.result,
        progress: initialProgress,
        metadata: snapshot.metadata,
        tabStatuses: snapshot.tabStatuses,
        statusSummary: initialStatusSummary,
      });
    }

    const allTabs = toTabRecords(snapshot.allTabs);
    const recommendationsById = new Map<number, TabRecommendation>(
      snapshot.result.tabRecommendations.map((recommendation) => [recommendation.tabId, recommendation]),
    );
    let pendingTabs = toTabRecords(snapshot.pendingTabs);
    let tabStatuses = snapshot.tabStatuses.length > 0
      ? [...snapshot.tabStatuses]
      : allTabs.map((tab) => ({
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        domain: tab.domain,
        status: 'pending' as const,
        source: 'pending' as const,
      }));
    let providerStatus = snapshot.metadata.providerStatus ?? createProviderRuntimeStatus(settings);
    let totalMetadata: AIAnalysisMetadata = {
      ...snapshot.metadata,
      providerAttempts: [...(snapshot.metadata.providerAttempts ?? [])],
      providerStatus,
    };
    let totalCached = snapshot.tabsCached;
    let totalAnalyzed = snapshot.tabsAnalyzed;
    let totalSaved = snapshot.tabsSaved;
    let fallbackNotice = snapshot.fallbackNotice ?? undefined;
    let providerOrderOverride = snapshot.providerOrderOverride.length > 0
      ? [...snapshot.providerOrderOverride]
      : undefined;

    while (pendingTabs.length > 0) {
      if (controller.signal.aborted) {
        throw new DOMException('Analysis aborted by user', 'AbortError');
      }

      const batchIndex = snapshot.batchesCompleted;
      const batch = pendingTabs.slice(0, ANALYSIS_BATCH_SIZE);
      const input: AISessionInput & { forceRefresh: boolean; providerOrder?: AIProviderId[] } = {
        tabs: batch.map((tab) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          domain: tab.domain,
          pinned: tab.pinned,
          active: tab.active,
          groupId: tab.groupId,
          groupName: tab.groupName,
        })),
        forceRefresh: snapshot.forceRefresh,
        providerOrder: providerOrderOverride,
      };

      snapshot = {
        ...snapshot,
        status: 'running',
        phase: 'analyzing',
        currentBatch: batchIndex + 1,
        updatedAt: Date.now(),
        metadata: {
          ...totalMetadata,
          providerStatus,
        },
      };
      snapshot = await updateServerAnalysisRun(snapshot, settings.localServerUrl);
      broadcast({
        type: 'AI_ANALYSIS_PROGRESS',
        progress: createProgressFromRun(snapshot),
      });

      let batchRecommendations: TabRecommendation[];
      let batchStatusMetadata: AIAnalysisMetadata | null = null;
      let batchStatusSource: TabAnalysisStatus['source'] | undefined;
      let batchSavedCount = 0;
      try {
        const response = await fetchLocalServerWithTimeout(settings.localServerUrl, '/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: controller.signal,
        }, ANALYSIS_BATCH_TIMEOUT_MS);

        if (!response.ok) {
          const detail = await readServerError(response);
          throw new Error(
            detail
              ? `AI server responded with ${response.status}: ${detail}`
              : `AI server responded with ${response.status}`,
          );
        }

        const serverResponse = (await response.json()) as ServerAnalyzeResponse;
        totalCached += serverResponse.cacheStats.tabsFromCache;
        totalAnalyzed += serverResponse.cacheStats.tabsAnalyzed;
        batchSavedCount = serverResponse.cacheStats.tabsSaved;

        totalMetadata.durationMs += serverResponse.metadata.durationMs;
        totalMetadata.durationApiMs += serverResponse.metadata.durationApiMs;
        totalMetadata.inputTokens += serverResponse.metadata.inputTokens;
        totalMetadata.outputTokens += serverResponse.metadata.outputTokens;
        totalMetadata.providerUsed = serverResponse.metadata.providerUsed;
        totalMetadata.modelUsed = serverResponse.metadata.modelUsed;
        totalMetadata.providerAttempts = [
          ...(totalMetadata.providerAttempts ?? []),
          ...(serverResponse.metadata.providerAttempts ?? []),
        ];
        if (serverResponse.metadata.totalCostUsd !== null) {
          totalMetadata.totalCostUsd = (totalMetadata.totalCostUsd ?? 0) + serverResponse.metadata.totalCostUsd;
        }
        providerStatus = mergeProviderRuntimeStatus(providerStatus, serverResponse.metadata, settings);
        totalMetadata.providerStatus = providerStatus;

        const stickyFallbackProvider = shouldStickToFallback(serverResponse.metadata.providerAttempts ?? []);
        if (stickyFallbackProvider) {
          providerOrderOverride = [stickyFallbackProvider];
        }

        batchRecommendations = serverResponse.result.tabRecommendations as TabRecommendation[];
        batchStatusMetadata = serverResponse.metadata;

        if (!fallbackNotice && serverResponse.result.summary !== undefined) {
          const summary = String(serverResponse.result.summary);
          const analyzedIndex = summary.indexOf('Analyzed ');
          const processedIndex = summary.indexOf('Processed ');
          const splitIndex = analyzedIndex > 0 ? analyzedIndex : processedIndex;
          if (splitIndex > 0) {
            fallbackNotice = summary.slice(0, splitIndex).trim();
          }
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        const batchFallbackNotice = summarizeBatchTransportIssue(error);
        fallbackNotice ??= batchFallbackNotice;
        providerStatus = {
          ...providerStatus,
          lastError: error instanceof Error ? error.message : String(error),
        };
        totalMetadata.providerStatus = providerStatus;
        totalAnalyzed += batch.length;
        batchRecommendations = buildClientFallbackRecommendations(
          batch,
          settings.staleDaysThreshold,
          batchFallbackNotice,
        );
        batchStatusMetadata = {
          durationMs: 0,
          durationApiMs: 0,
          totalCostUsd: null,
          inputTokens: 0,
          outputTokens: 0,
          tabCount: batch.length,
          providerUsed: null,
          modelUsed: null,
          providerAttempts: [],
          providerStatus,
        };
        batchStatusSource = 'heuristic';

        try {
          batchSavedCount = await importUrlAnalysesToServer(
            batch,
            batchRecommendations,
            batchStatusMetadata,
            Date.now(),
            settings.localServerUrl,
            'heuristic',
          );
        } catch (persistError) {
          providerStatus = {
            ...providerStatus,
            lastError: persistError instanceof Error ? persistError.message : String(persistError),
          };
          totalMetadata.providerStatus = providerStatus;
          batchSavedCount = 0;
        }
      }

      for (const recommendation of batchRecommendations) {
        recommendationsById.set(recommendation.tabId, recommendation);
      }

      totalSaved += batchSavedCount;
      tabStatuses = updateStatusesForBatch(
        tabStatuses,
        batch,
        batchRecommendations,
        batchStatusMetadata ?? totalMetadata,
        Date.now(),
        batchStatusSource,
      );
      pendingTabs = pendingTabs.slice(batch.length);
      const processedTabs = allTabs.filter((tab) => recommendationsById.has(tab.id));
      const partialRecommendations = processedTabs
        .map((tab) => recommendationsById.get(tab.id))
        .filter((recommendation): recommendation is TabRecommendation => recommendation !== undefined);
      const partialResult = buildAggregatedResult(processedTabs, partialRecommendations, fallbackNotice, allTabs.length);
      const processedCount = processedTabs.length;

      snapshot = {
        ...snapshot,
        phase: 'persisting',
        updatedAt: Date.now(),
        analyzedAt: Date.now(),
        tabsCached: totalCached,
        tabsAnalyzed: totalAnalyzed,
        tabsProcessed: processedCount,
        tabsRemaining: Math.max(allTabs.length - processedCount, 0),
        tabsSaved: totalSaved,
        batchesCompleted: batchIndex + 1,
        currentBatch: batchIndex + 1,
        providerOrderOverride: providerOrderOverride ?? [],
        fallbackNotice: fallbackNotice ?? null,
        result: partialResult,
        metadata: {
          ...totalMetadata,
          providerStatus,
        },
        pendingTabs: toPersistedRunTabs(pendingTabs),
        tabStatuses,
      };
      snapshot = await updateServerAnalysisRun(snapshot, settings.localServerUrl);
      await persistLocalAiResult(snapshot);

      const progress = createProgressFromRun(snapshot);
      const statusSummary = summarizeTabStatuses(tabStatuses);
      broadcast({
        type: 'AI_ANALYSIS_PARTIAL',
        result: partialResult,
        progress,
        metadata: snapshot.metadata,
        tabStatuses,
        statusSummary,
      });
      broadcast({ type: 'AI_ANALYSIS_PROGRESS', progress });
    }

    const finalRecommendations = allTabs
      .map((tab) => recommendationsById.get(tab.id))
      .filter((recommendation): recommendation is TabRecommendation => recommendation !== undefined);
    const finalResult = buildAggregatedResult(allTabs, finalRecommendations, fallbackNotice);
    const finalProviderStatus = totalAnalyzed === 0
      ? {
          ...providerStatus,
          currentProvider: null,
          currentModel: null,
          servedFromCacheOnly: true,
        }
      : providerStatus;

    totalMetadata = {
      ...totalMetadata,
      providerStatus: finalProviderStatus,
    };

    snapshot = {
      ...snapshot,
      status: 'completed',
      phase: 'processing',
      updatedAt: Date.now(),
      analyzedAt: Date.now(),
      tabsProcessed: allTabs.length,
      tabsRemaining: 0,
      tabsSaved: totalSaved,
      batchesCompleted: snapshot.batchesTotal,
      currentBatch: snapshot.batchesTotal,
      fallbackNotice: fallbackNotice ?? null,
      providerOrderOverride: providerOrderOverride ?? [],
      result: finalResult,
      metadata: totalMetadata,
      pendingTabs: [],
      tabStatuses,
    };
    snapshot = await updateServerAnalysisRun(snapshot, settings.localServerUrl);
    await persistLocalAiResult(snapshot);

    if (finalResult.topicClusters.length > 0) {
      const tabUrlMap = new Map(allTabs.map((tab) => [tab.id, tab.url]));
      const clustersToMerge = finalResult.topicClusters.map((cluster) => ({
        name: cluster.name,
        description: cluster.description,
        tags: cluster.tags,
        tabUrls: cluster.tabIds
          .map((id) => tabUrlMap.get(id))
          .filter((url): url is string => url !== undefined),
      }));
      mergeAIClusters(clustersToMerge).catch(() => {});
    }

    const finalProgress = createProgressFromRun(snapshot);
    const finalStatusSummary = summarizeTabStatuses(tabStatuses);
    broadcast({ type: 'AI_ANALYSIS_PROGRESS', progress: finalProgress });
    broadcast({
      type: 'AI_ANALYSIS_COMPLETE',
      result: finalResult,
      metadata: totalMetadata,
      fromCache: totalAnalyzed === 0,
      tabStatuses,
      statusSummary: finalStatusSummary,
    });
  } catch (error) {
    if (isAbortError(error)) {
      if (snapshot && settings) {
        snapshot = {
          ...snapshot,
          status: 'stopped',
          phase: 'stopped',
          updatedAt: Date.now(),
          analyzedAt: snapshot.analyzedAt ?? Date.now(),
          tabsSaved: snapshot.tabsSaved,
          error: null,
        };
        const STOP_PERSIST_TIMEOUT_MS = 5000;
        const persistAndBroadcast = async () => {
          snapshot = await updateServerAnalysisRun(snapshot!, settings!.localServerUrl);
          await persistLocalAiResult(snapshot!);
        };
        try {
          await Promise.race([
            persistAndBroadcast(),
            new Promise<never>((_, reject) =>
              globalThis.setTimeout(() => reject(new Error('Stop persistence timed out')), STOP_PERSIST_TIMEOUT_MS),
            ),
          ]);
        } catch {
          // Persistence timed out or failed — proceed with broadcast anyway
        }
        broadcast({
          type: 'AI_ANALYSIS_CANCELED',
          result: snapshot.result,
          metadata: snapshot.metadata,
          progress: createProgressFromRun(snapshot),
          resumable: snapshot.pendingTabs.length > 0,
          runId: snapshot.id,
          tabStatuses: snapshot.tabStatuses,
          statusSummary: summarizeTabStatuses(snapshot.tabStatuses),
        });
      } else {
        broadcast({ type: 'AI_ANALYSIS_CANCELED', resumable: false });
      }
      return;
    }

    if (snapshot && settings) {
      snapshot = {
        ...snapshot,
        status: 'failed',
        phase: 'stopped',
        updatedAt: Date.now(),
        analyzedAt: snapshot.analyzedAt ?? Date.now(),
        tabsSaved: snapshot.tabsSaved,
        error: error instanceof Error ? error.message : String(error),
      };
      await updateServerAnalysisRun(snapshot, settings.localServerUrl);
      await persistLocalAiResult(snapshot);
    }

    throw error;
  } finally {
    if (currentAnalysisRunId === runToken) {
      currentAnalysisController = null;
    }
  }
}

async function getCachedAIResult(): Promise<CachedAIResult | null> {
  try {
    const settings = await getSettings();
    const latestRun = await getLatestServerAnalysisRun(settings.localServerUrl);
    if (latestRun) {
      return {
        result: latestRun.result,
        analyzedAt: latestRun.analyzedAt ?? latestRun.updatedAt,
        metadata: latestRun.metadata,
        fingerprint: latestRun.fingerprint,
      };
    }
  } catch {
    // Fall back to local cache when server-backed state is unavailable.
  }

  const data = await chrome.storage.local.get('lastAIResult');
  return (data.lastAIResult as CachedAIResult) ?? null;
}

// ─── Content Script Injection ────────────────────────────

async function extractPageContent(tabId: number): Promise<PageExtraction> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/page-extractor.js'],
  });

  const response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE_DATA' });
  return response as PageExtraction;
}

// ─── Auto-Snapshots ─────────────────────────────────────

async function setupAutoSnapshot(): Promise<void> {
  const settings = await getSettings();
  await chrome.alarms.clear('auto-snapshot');
  if (settings.autoSnapshotEnabled) {
    chrome.alarms.create('auto-snapshot', {
      periodInMinutes: settings.autoSnapshotIntervalHours * 60,
    });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'auto-snapshot') {
    const snapshot = await createSnapshot(undefined, 'auto');
    broadcast({ type: 'SNAPSHOT_CREATED', snapshot });
  } else if (alarm.name === 'cleanup-history') {
    await cleanupOldHistory();
  }
});

// ─── Message Handler ─────────────────────────────────────

type AnyResponse =
  | MessageResponse
  | GetAllTabsResponse
  | GetSnapshotsResponse
  | GetTabHistoryResponse
  | GetAIResultResponse
  | GetTabAnalysisStatusResponse;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === SIDEPANEL_KEEPALIVE_PORT) {
    registerKeepalivePort(port);
  }
});

chrome.runtime.onMessage.addListener(
  (message: MessageRequest, _sender, sendResponse: (response: AnyResponse) => void) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
);

async function handleMessage(msg: MessageRequest): Promise<AnyResponse> {
  switch (msg.type) {
    case 'GET_ALL_TABS': {
      const data = await getAllTabs();
      const flags = await getUserFlags();
      for (const wg of data.windowGroups) {
        for (const tab of wg.tabs) {
          if (flags[tab.id]) {
            tab.userFlag = flags[tab.id];
          }
        }
      }
      return { success: true, data };
    }

    case 'CLOSE_TABS': {
      await Promise.all(msg.tabIds.map((id) => chrome.tabs.remove(id).catch(() => {})));
      return { success: true };
    }

    case 'PIN_TAB': {
      await chrome.tabs.update(msg.tabId, { pinned: msg.pinned });
      return { success: true };
    }

    case 'SET_USER_FLAG': {
      await setUserFlag(msg.tabId, msg.flag);
      return { success: true };
    }

    case 'CREATE_SNAPSHOT': {
      const snapshot = await createSnapshot(msg.name, msg.trigger);
      return { success: true, data: snapshot };
    }

    case 'GET_SNAPSHOTS': {
      const snapshots = await getSnapshots();
      return { success: true, data: { snapshots } };
    }

    case 'GET_SNAPSHOT': {
      const all = await getSnapshots();
      const snap = all.find((s) => s.id === msg.id);
      if (!snap) return { success: false, error: 'Snapshot not found' };
      return { success: true, data: snap };
    }

    case 'DELETE_SNAPSHOT': {
      await deleteSnapshotRecord(msg.id);
      return { success: true };
    }

    case 'RESTORE_SNAPSHOT': {
      const allSnaps = await getSnapshots();
      const target = allSnaps.find((s) => s.id === msg.id);
      if (!target) return { success: false, error: 'Snapshot not found' };

      const urls = msg.tabUrls ??
        target.windows.flatMap((w) => w.tabs.map((t) => t.url));

      if (urls.length > 0) {
        const newWindow = await chrome.windows.create({ url: urls[0] });
        if (newWindow?.id) {
          for (let i = 1; i < urls.length; i++) {
            await chrome.tabs.create({ windowId: newWindow.id, url: urls[i] });
          }
        }
      }
      return { success: true };
    }

    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { success: true, data: settings };
    }

    case 'SAVE_SETTINGS': {
      const updated = await saveSettings(msg.settings);
      await setupAutoSnapshot();
      return { success: true, data: updated };
    }

    case 'GET_SERVER_DB_STATUS': {
      const status = await getServerDbStatus();
      return { success: true, data: { status } };
    }

    case 'GET_SERVER_RUNTIME_LOGS': {
      const logs = await getServerRuntimeLogs(msg.limit ?? 20);
      return { success: true, data: { logs } };
    }

    case 'SYNC_SERVER_PERSISTENCE': {
      await syncServerPersistenceNow();
      return { success: true, data: { synced: true } };
    }

    case 'CLEAR_SERVER_DB': {
      const status = await clearServerDatabase();
      return { success: true, data: { status } };
    }

    case 'GET_LLM_CALL_LOGS': {
      const logs = await getLLMCallLogs(msg.limit ?? 50, msg.sessionTimestamp, msg.provider);
      return { success: true, data: { logs } };
    }

    case 'GET_URL_CACHE_LIST': {
      const result = await getUrlCacheList(msg.limit ?? 50, msg.offset ?? 0, msg.domain, msg.action);
      return { success: true, data: result };
    }

    case 'DELETE_URL_CACHE': {
      const deleted = await deleteUrlCache(msg.urls, msg.domainPattern);
      return { success: true, data: { deleted } };
    }

    case 'GET_ANALYSIS_SESSIONS': {
      const sessions = await getAnalysisSessions(msg.limit ?? 50, msg.offset ?? 0);
      return { success: true, data: { sessions } };
    }

    case 'DELETE_ANALYSIS_SESSION': {
      await deleteAnalysisSession(msg.sessionId);
      return { success: true, data: { deleted: true } };
    }

    case 'GROUP_TABS_BY_CLUSTER': {
      await groupTabsByCluster(msg.tabIds, msg.name, msg.color);
      return { success: true };
    }

    case 'GET_TAB_INSIGHTS': {
      const insights = await getTabInsights();
      return { success: true, data: { insights } };
    }

    case 'GET_HABITS_SCORE': {
      const habitsScore = await getHabitsScore();
      return { success: true, data: { habitsScore } };
    }

    case 'TRACK_RECOMMENDATION': {
      await trackRecommendation(msg.action);
      return { success: true };
    }

    case 'GET_RECOMMENDATION_STATS': {
      const stats = await getRecommendationStats();
      return { success: true, data: { stats } };
    }

    case 'GET_ACTIVITY_HEATMAP': {
      const heatmap = await getActivityHeatmap(msg.domain);
      return { success: true, data: { heatmap } };
    }

    case 'GET_PERSISTENT_CLUSTERS': {
      const clusters = await getPersistentClusters();
      return { success: true, data: { clusters } };
    }

    case 'MERGE_AI_CLUSTERS': {
      const mergeResult = await mergeAIClusters(msg.clusters);
      return { success: true, data: mergeResult };
    }

    case 'RENAME_CLUSTER': {
      await renameCluster(msg.clusterId, msg.name);
      return { success: true };
    }

    case 'DELETE_CLUSTER': {
      await deleteCluster(msg.clusterId);
      return { success: true };
    }

    case 'FOCUS_ON_CLUSTER': {
      const focusResult = await focusOnCluster(msg.clusterId);
      return { success: true, data: focusResult };
    }

    case 'EXIT_FOCUS_MODE': {
      await exitFocusMode();
      return { success: true };
    }

    case 'GET_CLUSTER_TAB_MATCHES': {
      const matches = await getClusterTabMatches(msg.clusterId);
      return { success: true, data: matches };
    }

    case 'OPEN_URL': {
      const tab = await chrome.tabs.create({ url: msg.url });
      return { success: true, data: { tabId: tab.id } };
    }

    case 'FOCUS_TAB': {
      const tab = await chrome.tabs.get(msg.tabId);
      await chrome.tabs.update(msg.tabId, { active: true });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return { success: true };
    }

    case 'CHAT_SEARCH': {
      const data = await fetchServerJson<{
        answer: string;
        results: unknown[];
        followUpSuggestions: string[];
        llmUsed: boolean;
        totalCandidates: number;
        providerUsed: string | null;
        modelUsed: string | null;
      }>(
        '/chat',
        {
          method: 'POST',
          body: JSON.stringify({
            query: msg.query,
            history: msg.history ?? [],
            maxResults: msg.maxResults ?? 30,
          }),
        },
      );
      return { success: true, data };
    }

    case 'REFRESH_ANALYTICS': {
      const data = await fetchServerJson<{
        analyticsInsight: {
          browsingPatterns: string;
          suggestions: string[];
          clusterInsights: { clusterName: string; insight: string }[];
          habitsCommentary: string;
        } | null;
        topicClusters?: { name: string; tabIds: number[]; description: string; tags: string[] }[];
        providerUsed: string | null;
        modelUsed: string | null;
        error: string | null;
      }>('/analytics/refresh', { method: 'POST' });
      return { success: true, data };
    }

    case 'GET_TAB_HISTORY': {
      const result = await getTabHistory(msg.timeframe, msg.limit ?? 0, msg.offset ?? 0);
      return { success: true, data: result };
    }

    case 'GET_TAB_ANALYSIS_STATUS': {
      const { windowGroups } = await getAllTabs();
      const tabs = windowGroups.flatMap((wg) => wg.tabs);
      const settings = await getSettings();
      const fingerprint = computeTabFingerprint(tabs.map((tab) => tab.url));
      const latestRun = await getLatestServerAnalysisRun(settings.localServerUrl, fingerprint);
      if (latestRun && latestRun.tabStatuses.length > 0 && (latestRun.status === 'running' || latestRun.status === 'stopped')) {
        return {
          success: true,
          data: {
            statuses: latestRun.tabStatuses,
            summary: summarizeTabStatuses(latestRun.tabStatuses),
          },
        };
      }
      const data = await fetchTabAnalysisStatus(tabs, settings.localServerUrl, msg.forceRefresh ?? false);
      return { success: true, data };
    }

    case 'ANALYZE_TABS': {
      analyzeTabsViaServer(msg.forceRefresh ?? false, msg.resume ?? false).catch((err) => {
        if (isAbortError(err)) {
          return;
        }
        broadcast({ type: 'AI_ANALYSIS_ERROR', error: String(err) });
      });
      return { success: true, data: { status: 'started' } };
    }

    case 'STOP_AI_ANALYSIS': {
      currentAnalysisController?.abort();
      currentAnalysisController = null;
      getSettings().then((s) => {
        fetchLocalServer(s.localServerUrl, '/analyze/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      }).catch(() => {});
      return { success: true, data: { stopped: true } };
    }

    case 'GET_AI_RESULT': {
      try {
        const settings = await getSettings();
        const latestRun = await getLatestServerAnalysisRun(settings.localServerUrl);
        if (latestRun) {
          return {
            success: true,
            data: {
              result: latestRun.result,
              analyzedAt: latestRun.analyzedAt ?? latestRun.updatedAt,
              metadata: latestRun.metadata,
              fingerprint: latestRun.fingerprint,
              progress: createProgressFromRun(latestRun),
              status: latestRun.status,
              resumable: latestRun.pendingTabs.length > 0 && latestRun.status === 'stopped',
              runId: latestRun.id,
              tabStatuses: latestRun.tabStatuses,
              statusSummary: summarizeTabStatuses(latestRun.tabStatuses),
            },
          };
        }
      } catch {
        // Fall back to the last local cache below.
      }

      const cached = await getCachedAIResult();
      if (!cached) return { success: false, error: 'No analysis result cached' };
      return {
        success: true,
        data: {
          ...cached,
          progress: null,
          status: 'completed',
          resumable: false,
          runId: undefined,
        },
      };
    }

    case 'EXTRACT_PAGE': {
      const extraction = await extractPageContent(msg.tabId);
      return { success: true, data: extraction };
    }

    case 'START_CLEANUP_SESSION': {
      const preSnapshot = await createSnapshot('Pre-cleanup snapshot', 'pre-cleanup');
      const cached = await getCachedAIResult();
      return { success: true, data: { snapshot: preSnapshot, aiResult: cached?.result ?? null } };
    }

    case 'APPLY_CLEANUP_ACTION': {
      if (msg.action === 'close') {
        await chrome.tabs.remove(msg.tabId).catch(() => {});
      } else if (msg.action === 'group') {
        // Group action handled in side panel via Chrome tab groups API
      }
      return { success: true };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// ─── Broadcast helper ────────────────────────────────────

function broadcast(event: Record<string, unknown>) {
  chrome.runtime.sendMessage(event).catch(() => {});
}

// ─── Tab Event Listeners ─────────────────────────────────

function broadcastUpdate() {
  broadcast({ type: 'TABS_UPDATED' });
}

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id && tab.url) {
    const domain = extractDomain(tab.url);
    updateTabCache(tab.id, tab.url, tab.title ?? '');
    if (isTrackableHistoryUrl(tab.url)) {
      await logTabEvent(tab.id, tab.url, tab.title ?? '', domain, 'opened');
    }
  }
  broadcastUpdate();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const cached = tabInfoCache.get(tabId);
  if (cached) {
    await logTabEvent(tabId, cached.url, cached.title, cached.domain, 'closed');
    tabInfoCache.delete(tabId);
  }
  broadcastUpdate();
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      const domain = extractDomain(tab.url);
      updateTabCache(tab.id!, tab.url, tab.title ?? '');
      await logTabEvent(tab.id!, tab.url, tab.title ?? '', domain, 'activated');
    }
  } catch {
    // Tab may have been closed
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void (async () => {
    const previousUrl = tabInfoCache.get(tabId)?.url;
    const nextUrl = tab.url ?? '';

    if (changeInfo.url && nextUrl && nextUrl !== previousUrl && isTrackableHistoryUrl(nextUrl)) {
      await logTabEvent(tabId, nextUrl, tab.title ?? '', extractDomain(nextUrl), 'opened');
    }

    if (changeInfo.url || changeInfo.title) {
      updateTabCache(tabId, nextUrl, tab.title ?? '');
    }
  })();

  if (changeInfo.title || changeInfo.url || changeInfo.pinned !== undefined) {
    broadcastUpdate();
  }
});

chrome.tabs.onMoved.addListener(broadcastUpdate);
chrome.tabs.onAttached.addListener(broadcastUpdate);
chrome.tabs.onDetached.addListener(broadcastUpdate);

// ─── Open side panel on action click ─────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// ─── Startup: setup alarms ──────────────────────────────

setupAutoSnapshot();
void ensureServerPersistenceSync().catch(() => {});

// History cleanup alarm (daily)
chrome.alarms.create('cleanup-history', { periodInMinutes: 1440 });
