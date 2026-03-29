import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useI18n, type TranslationKey } from '@shared/i18n';
import type {
  AIAnalysisResult,
  AIProviderAttempt,
  AIProviderId,
  AIProviderRuntimeStatus,
  RecommendedAction,
  TopicCluster,
  TabRecord,
  TabRecommendation,
  TabInsights,
  HabitsScore,
  RecommendationActionStats,
  PersistentCluster,
  TabAnalysisStatus,
  TabAnalysisStatusSummary,
  WindowGroup,
} from '@shared/types';
import { exportTopicCluster } from '@shared/utils/obsidian';

const ACTION_COLORS: Record<RecommendedAction, string> = {
  keep: 'bg-green-100 text-green-700',
  group: 'bg-blue-100 text-blue-700',
  read_later: 'bg-yellow-100 text-yellow-700',
  archive: 'bg-purple-100 text-purple-700',
  close: 'bg-red-100 text-red-700',
};

const ACTION_LABELS: Record<RecommendedAction, string> = {
  keep: 'ai.keep',
  group: 'ai.group',
  read_later: 'ai.readLater',
  archive: 'ai.archive',
  close: 'ai.close',
};

type TranslateFn = (key: TranslationKey) => string;

function getProviderLabel(
  provider: AIProviderId | 'none' | null,
  t: TranslateFn,
) {
  if (provider === 'claude_code') return t('settings.providerClaudeCode');
  if (provider === 'codex_cli') return t('settings.providerCodexCli');
  if (provider === 'none') return t('settings.providerNone');
  return t('ai.statusWaiting');
}

function formatProviderTarget(
  provider: AIProviderId | 'none' | null,
  model: string | null | undefined,
  t: TranslateFn,
) {
  const providerLabel = getProviderLabel(provider, t);
  return model ? `${providerLabel} · ${model}` : providerLabel;
}

function aggregateAttempts(attempts: AIProviderAttempt[]) {
  const groups = new Map<string, {
    provider: AIProviderId;
    model: string | null;
    successes: number;
    failures: number;
    lastError: string | null;
  }>();

  for (const attempt of attempts) {
    const key = `${attempt.provider}:${attempt.model ?? ''}`;
    const existing = groups.get(key) ?? {
      provider: attempt.provider,
      model: attempt.model ?? null,
      successes: 0,
      failures: 0,
      lastError: null,
    };

    if (attempt.status === 'succeeded') {
      existing.successes += 1;
    } else {
      existing.failures += 1;
      existing.lastError = attempt.error ?? existing.lastError;
    }

    groups.set(key, existing);
  }

  return [...groups.values()];
}

function RuntimeStatusCard() {
  const { aiLoading, aiProgress, aiMetadata, aiFromCache } = useStore();
  const { t } = useI18n();
  const providerStatus = aiLoading
    ? aiProgress?.providerStatus ?? aiMetadata?.providerStatus
    : aiMetadata?.providerStatus;

  if (!providerStatus) {
    return null;
  }

  const attemptSummary = aggregateAttempts(providerStatus.attempts);
  const isFallbackActive = Boolean(
    providerStatus.currentProvider &&
    providerStatus.currentProvider !== providerStatus.primaryProvider &&
    providerStatus.attempts.some((attempt) => attempt.status === 'failed'),
  );
  const badgeLabel = providerStatus.servedFromCacheOnly || aiFromCache
    ? t('ai.statusCacheOnly')
    : aiLoading
      ? (isFallbackActive ? t('ai.statusFailover') : t('ai.statusRunning'))
      : t('ai.statusCompleted');
  const badgeClassName = providerStatus.servedFromCacheOnly || aiFromCache
    ? 'bg-blue-100 text-blue-700'
    : isFallbackActive
      ? 'bg-amber-100 text-amber-700'
      : aiLoading
        ? 'bg-green-100 text-green-700'
        : 'bg-gray-100 text-gray-700';

  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-medium text-gray-800">{t('ai.runtimeStatus')}</p>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeClassName}`}>
          {badgeLabel}
        </span>
      </div>

      <div className="space-y-1 text-[11px]">
        <div>
          <span className="text-gray-500">{t('ai.currentProvider')}:</span>{' '}
          <span className="font-medium">
            {providerStatus.servedFromCacheOnly
              ? t('ai.statusCacheOnly')
              : formatProviderTarget(providerStatus.currentProvider, providerStatus.currentModel, t)}
          </span>
        </div>
        <div>
          <span className="text-gray-500">{t('ai.providerChain')}:</span>{' '}
          <span className="font-medium">
            {formatProviderTarget(providerStatus.primaryProvider, null, t)}
            {providerStatus.fallbackProvider !== 'none' && (
              <> {' -> '} {formatProviderTarget(providerStatus.fallbackProvider, null, t)}</>
            )}
          </span>
        </div>
      </div>

      {attemptSummary.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">
            {t('ai.providerAttempts')}
          </p>
          {attemptSummary.map((item) => (
            <div key={`${item.provider}:${item.model ?? 'default'}`} className="rounded bg-white px-2 py-1 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-700">
                  {formatProviderTarget(item.provider, item.model, t)}
                </span>
                <span className="text-gray-500">
                  {t('ai.successCount')}: {item.successes} · {t('ai.failureCount')}: {item.failures}
                </span>
              </div>
              {item.lastError && (
                <div className="mt-0.5 max-h-24 overflow-y-auto break-words text-[10px] text-red-500">
                  {item.lastError}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-gray-500">
          {t('ai.waitingForProvider')}
        </div>
      )}
    </div>
  );
}

function AnalysisProgress() {
  const { aiProgress } = useStore();
  const { t } = useI18n();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!aiProgress) return;
    const start = aiProgress.startedAt;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [aiProgress?.startedAt]);

  if (!aiProgress) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const phaseKey = `ai.progress.${aiProgress.phase}` as 'ai.progress.preparing';
  const processedPercent = aiProgress.tabsTotal > 0
    ? Math.min(100, Math.round((aiProgress.tabsProcessed / aiProgress.tabsTotal) * 100))
    : 0;
  const cachedPercent = aiProgress.tabsTotal > 0
    ? Math.min(100, (aiProgress.tabsCached / aiProgress.tabsTotal) * 100)
    : 0;
  const savedPercent = 0;
  const activePercent = Math.max(0, processedPercent - cachedPercent);
  const isActive = aiProgress.phase !== 'stopped';

  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-center justify-center">
        {isActive ? (
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700">
            !
          </div>
        )}
      </div>
      <p className="text-xs font-medium text-center text-gray-700">{t(phaseKey)}</p>
      {aiProgress.providerStatus?.currentProvider && (
        <p className="text-[11px] text-center text-gray-500 font-medium">
          {formatProviderTarget(aiProgress.providerStatus.currentProvider, aiProgress.providerStatus.currentModel, t)}
        </p>
      )}

      <div className="space-y-1">
        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
          <div className="flex h-full w-full overflow-hidden rounded-full">
            {cachedPercent > 0 && (
              <div
                className="h-full bg-blue-200"
                style={{ width: `${cachedPercent}%` }}
              />
            )}
            {savedPercent > 0 && (
              <div
                className="h-full bg-green-400/80"
                style={{ width: `${savedPercent}%` }}
              />
            )}
            {activePercent > 0 && (
              <div
                className="h-full bg-accent"
                style={{ width: `${activePercent}%` }}
              />
            )}
          </div>
        </div>
        <div className="flex items-center justify-between text-[10px] text-gray-500">
          <span>{t('ai.processed')}: {aiProgress.tabsProcessed} / {aiProgress.tabsTotal}</span>
          <span>{processedPercent}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500 sm:grid-cols-5">
        <div className="rounded bg-gray-50 px-2 py-1">
          {t('ai.fromCache')}: {aiProgress.tabsCached}
        </div>
        <div className="rounded bg-gray-50 px-2 py-1">
          {t('ai.newTabs')}: {aiProgress.tabsAnalyzed}
        </div>
        <div className="rounded bg-gray-50 px-2 py-1">
          {t('ai.remaining')}: {aiProgress.tabsRemaining}
        </div>
        <div className="rounded bg-gray-50 px-2 py-1">
          {t('ai.saved')}: {aiProgress.tabsSaved}
        </div>
        <div className="rounded bg-gray-50 px-2 py-1">
          {t('ai.batches')}: {aiProgress.batchesCompleted}/{aiProgress.batchesTotal}
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-gray-400 tabular-nums">
        <span>{t('ai.currentBatch')}: {Math.max(aiProgress.currentBatch, 0)} / {Math.max(aiProgress.batchesTotal, 0)}</span>
        <span>{elapsed}s</span>
      </div>
    </div>
  );
}

function AnalysisMetadataBar() {
  const { aiMetadata, aiFromCache, aiAnalyzedAt, analyzeTabs, aiLoading, stopAIAnalysis } = useStore();
  const { t } = useI18n();

  if (!aiAnalyzedAt) return null;

  const agoMinutes = Math.floor((Date.now() - aiAnalyzedAt) / 60000);
  const agoText = agoMinutes < 1 ? 'just now' : `${agoMinutes}m ago`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 bg-gray-50 rounded text-[10px] text-gray-500">
      {aiFromCache && (
        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded font-medium">
          {t('ai.fromCache')}
        </span>
      )}
      {aiMetadata && (
        <>
          {aiMetadata.providerUsed && (
            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium">
              {formatProviderTarget(aiMetadata.providerUsed, aiMetadata.modelUsed, t)}
            </span>
          )}
          <span>{t('ai.duration')} {(aiMetadata.durationMs / 1000).toFixed(1)}s</span>
          <span>{t('ai.tokens')}: {aiMetadata.inputTokens} / {aiMetadata.outputTokens}</span>
          {aiMetadata.totalCostUsd !== null && (
            <span>{t('ai.cost')}: ${aiMetadata.totalCostUsd.toFixed(4)}</span>
          )}
        </>
      )}
      <span>{t('ai.lastAnalysis')}: {agoText}</span>
      <button
        onClick={() => analyzeTabs(true)}
        disabled={aiLoading}
        className="ml-auto text-accent hover:underline"
      >
        {t('ai.forceRefresh')}
      </button>
      <button
        onClick={() => void stopAIAnalysis()}
        disabled={!aiLoading}
        className="text-red-500 hover:underline disabled:text-gray-300"
      >
        {t('ai.stop')}
      </button>
    </div>
  );
}

function summarizeStatusesLocally(statuses: TabAnalysisStatus[]): TabAnalysisStatusSummary {
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

function formatStatusTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
}

function getTabStatusBadge(status: TabAnalysisStatus, t: TranslateFn) {
  if (status.status === 'cached') {
    return {
      label: t('ai.fromCache'),
      className: 'bg-blue-100 text-blue-700',
    };
  }
  if (status.status === 'analyzed' && status.source === 'heuristic') {
    return {
      label: t('ai.statusHeuristic'),
      className: 'bg-amber-100 text-amber-700',
    };
  }
  if (status.status === 'analyzed') {
    return {
      label: t('ai.statusAiDone'),
      className: 'bg-green-100 text-green-700',
    };
  }
  if (status.status === 'failed') {
    return {
      label: t('ai.statusFailed'),
      className: 'bg-red-100 text-red-700',
    };
  }
  return {
    label: t('ai.statusPending'),
    className: 'bg-gray-100 text-gray-600',
  };
}

function getPendingDomainSummary(statuses: TabAnalysisStatus[]) {
  const counts = new Map<string, number>();
  for (const status of statuses) {
    counts.set(status.domain, (counts.get(status.domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);
}

function AnalyticsSnapshotCard({
  aiResult,
  insights,
  habitsScore,
  recStats,
  showInsights,
  onToggle,
}: {
  aiResult: AIAnalysisResult | null;
  insights: TabInsights | null;
  habitsScore: HabitsScore | null;
  recStats: RecommendationActionStats | null;
  showInsights: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const topTheme = aiResult?.topicClusters[0];

  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="font-medium text-gray-800">{t('ai.analyticsSnapshot')}</p>
          <p className="text-[10px] text-gray-500">{t('ai.analyticsSnapshotHint')}</p>
        </div>
        <button
          onClick={onToggle}
          className="text-[10px] font-medium text-accent hover:underline"
        >
          {showInsights ? t('ai.hideInsights') : t('ai.showInsights')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] text-gray-400">{t('ai.analyticsTopTheme')}</div>
          <div className="truncate font-medium text-gray-700">{topTheme?.name ?? '—'}</div>
          {topTheme && <div className="text-[10px] text-gray-400">{topTheme.tabIds.length} {t('ai.tabsAnalyzing')}</div>}
        </div>
        <div className="rounded bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] text-gray-400">{t('ai.analyticsHealth')}</div>
          <div className="font-medium text-gray-700">{habitsScore ? habitsScore.score : '—'}</div>
          <div className="text-[10px] text-gray-400">
            {habitsScore ? t(`habits.${habitsScore.trend}` as 'habits.improving') : '—'}
          </div>
        </div>
        <div className="rounded bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] text-gray-400">{t('ai.analyticsSessions')}</div>
          <div className="font-medium text-gray-700">{insights?.avgAnalysisStats.totalSessions ?? '—'}</div>
          <div className="text-[10px] text-gray-400">
            {insights ? `${t('ai.avgTabs')}: ${insights.avgAnalysisStats.avgTabs}` : '—'}
          </div>
        </div>
        <div className="rounded bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] text-gray-400">{t('ai.analyticsAcceptance')}</div>
          <div className="font-medium text-gray-700">
            {recStats ? `${Math.round(recStats.acceptanceRate * 100)}%` : '—'}
          </div>
          <div className="text-[10px] text-gray-400">
            {recStats ? `${recStats.totalActions} ${t('ai.analyticsActions').toLowerCase()}` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

function SuggestedNextSteps({
  aiResult,
  statusSummary,
  pendingDomains,
  tabMap,
  onAnalyzeRemaining,
  onStartCleanup,
}: {
  aiResult: AIAnalysisResult;
  statusSummary: TabAnalysisStatusSummary;
  pendingDomains: Array<[string, number]>;
  tabMap: Map<number, TabRecord>;
  onAnalyzeRemaining: () => void;
  onStartCleanup: () => void;
}) {
  const { t } = useI18n();
  const availableCluster = aiResult.topicClusters.find((cluster) => cluster.tabIds.some((tabId) => tabMap.has(tabId)));
  const closeCount = aiResult.sessionStats.estimatedClosable;
  const readLaterCount = aiResult.sessionStats.actionBreakdown?.read_later ?? 0;

  const cards: Array<{
    id: string;
    title: string;
    body: string;
    actionLabel: string;
    tone: string;
    onAction: () => void;
  }> = [];

  if (statusSummary.pending > 0) {
    const topDomains = pendingDomains.slice(0, 3).map(([domain, count]) => `${domain} (${count})`).join(', ');
    cards.push({
      id: 'remaining',
      title: t('ai.nextAnalyzeRemainingTitle'),
      body: topDomains
        ? `${statusSummary.pending} ${t('ai.nextAnalyzeRemainingBody')} ${topDomains}.`
        : `${statusSummary.pending} ${t('ai.nextAnalyzeRemainingBody')}.`,
      actionLabel: t('ai.analyze'),
      tone: 'border-amber-200 bg-amber-50 text-amber-800',
      onAction: onAnalyzeRemaining,
    });
  }

  if (closeCount > 0) {
    cards.push({
      id: 'cleanup',
      title: t('ai.nextCleanupTitle'),
      body: `${closeCount} ${t('ai.nextCleanupBody')}`,
      actionLabel: t('ai.startCleanup'),
      tone: 'border-red-200 bg-red-50 text-red-800',
      onAction: onStartCleanup,
    });
  }

  if (availableCluster) {
    cards.push({
      id: 'cluster',
      title: t('ai.nextGroupTitle'),
      body: `${availableCluster.name} · ${availableCluster.tabIds.length} ${t('ai.tabsAnalyzing')}`,
      actionLabel: t('clusters.groupTabs'),
      tone: 'border-blue-200 bg-blue-50 text-blue-800',
      onAction: () => {
        void chrome.runtime.sendMessage({
          type: 'GROUP_TABS_BY_CLUSTER',
          tabIds: availableCluster.tabIds,
          name: availableCluster.name,
        });
      },
    });
  } else if (readLaterCount > 0) {
    cards.push({
      id: 'read-later',
      title: t('ai.nextReadLaterTitle'),
      body: `${readLaterCount} ${t('ai.nextReadLaterBody')}`,
      actionLabel: t('ai.startCleanup'),
      tone: 'border-yellow-200 bg-yellow-50 text-yellow-800',
      onAction: onStartCleanup,
    });
  }

  if (cards.length === 0) {
    return null;
  }

  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
      <div className="mb-2">
        <p className="font-medium text-gray-800">{t('ai.nextSteps')}</p>
        <p className="text-[10px] text-gray-500">{t('ai.nextStepsHint')}</p>
      </div>
      <div className="space-y-2">
        {cards.slice(0, 3).map((card) => (
          <div key={card.id} className={`rounded border px-2.5 py-2 ${card.tone}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{card.title}</p>
                <p className="mt-0.5 text-[11px]">{card.body}</p>
              </div>
              <button
                onClick={card.onAction}
                className="shrink-0 rounded bg-white/80 px-2 py-1 text-[10px] font-medium hover:bg-white"
              >
                {card.actionLabel}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function normalizeClusterTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function ThemeComparisonCard({
  topicClusters,
  persistentClusters,
  loading,
  windowGroups,
  closeTabs,
}: {
  topicClusters: TopicCluster[];
  persistentClusters: PersistentCluster[];
  loading: boolean;
  windowGroups: WindowGroup[];
  closeTabs: (ids: number[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const [expandedClusterName, setExpandedClusterName] = useState<string | null>(null);

  if (topicClusters.length === 0) {
    return null;
  }

  if (loading) {
    return (
      <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
        <div className="mb-2">
          <p className="font-medium text-gray-800">{t('ai.themeComparison')}</p>
          <p className="text-[10px] text-gray-500">{t('ai.themeComparisonHint')}</p>
        </div>
        <div className="rounded border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
          {t('ai.themeComparisonLoading')}
        </div>
      </div>
    );
  }

  if (persistentClusters.length === 0) {
    return (
      <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
        <div className="mb-2">
          <p className="font-medium text-gray-800">{t('ai.themeComparison')}</p>
          <p className="text-[10px] text-gray-500">{t('ai.themeComparisonHint')}</p>
        </div>
        <div className="rounded border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {t('ai.themeComparisonEmpty')}
        </div>
      </div>
    );
  }

  const allTabs = windowGroups.flatMap((wg) => wg.tabs);
  const comparisons = topicClusters
    .slice(0, 5)
    .map((cluster) => {
      const clusterTags = cluster.tags.map(normalizeClusterTag);
      const matches = persistentClusters
        .map((saved) => {
          const savedTags = saved.tags.map(normalizeClusterTag);
          const overlap = clusterTags.filter((tag) => savedTags.includes(tag));
          return {
            saved,
            overlap,
          };
        })
        .filter((entry) => entry.overlap.length > 0)
        .sort((left, right) => right.overlap.length - left.overlap.length || right.saved.tabUrls.length - left.saved.tabUrls.length)
        .slice(0, 2);

      return {
        cluster,
        matches,
      };
    });

  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
      <div className="mb-2">
        <p className="font-medium text-gray-800">{t('ai.themeComparison')}</p>
        <p className="text-[10px] text-gray-500">{t('ai.themeComparisonHint')}</p>
      </div>
      <div className="space-y-2">
        {comparisons.map(({ cluster, matches }) => {
          const isExpanded = expandedClusterName === cluster.name;
          const tabEntries = isExpanded ? cluster.tabIds.map((tabId, index) => {
            const tab = allTabs.find((t) => t.id === tabId);
            const fallbackUrl = tab?.url ?? cluster.tabUrls?.[index] ?? '';
            const currentTab = tab ?? (fallbackUrl ? allTabs.find((t) => t.url === fallbackUrl) : undefined);
            const displayUrl = currentTab?.url ?? fallbackUrl;
            const domain = displayUrl ? (() => { try { return new URL(displayUrl).hostname; } catch { return ''; } })() : '';
            return { tabId, tab: currentTab, domain, isOpen: !!currentTab, title: currentTab?.title ?? displayUrl, url: displayUrl };
          }) : [];
          const openCount = isExpanded ? tabEntries.filter((e) => e.isOpen).length : 0;

          return (
            <div key={cluster.name} className="rounded bg-gray-50 px-2.5 py-2">
              <div
                className="flex cursor-pointer items-center justify-between gap-2"
                onClick={() => setExpandedClusterName(isExpanded ? null : cluster.name)}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="text-[10px] text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-800">{cluster.name}</p>
                    <p className="mt-0.5 text-[10px] text-gray-500">{cluster.description}</p>
                  </div>
                </div>
                <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                  {cluster.tabIds.length} {t('ai.tabsAnalyzing')}
                </span>
              </div>
              {cluster.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {cluster.tags.slice(0, 4).map((tag) => (
                    <span key={`${cluster.name}:${tag}`} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-600">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {isExpanded && (
                <div className="mt-1.5 space-y-1 border-t border-gray-200 pt-1.5">
                  <div className="text-[10px] text-gray-400">
                    {t('clusters.openCount').replace('{open}', String(openCount)).replace('{total}', String(cluster.tabIds.length))}
                  </div>
                  <div className="max-h-48 space-y-0.5 overflow-y-auto">
                    {tabEntries.filter((e) => e.title).map((entry) => (
                      <div key={entry.tabId} className="flex items-center gap-1.5 rounded bg-white px-1.5 py-1">
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${entry.domain}&sz=16`}
                          alt=""
                          className="h-3 w-3 shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[10px] text-gray-700" title={entry.url}>
                          {entry.title}
                        </span>
                        {entry.isOpen && entry.tab ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="rounded bg-green-50 px-1 text-[9px] text-green-600">Open</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); chrome.runtime.sendMessage({ type: 'FOCUS_TAB', tabId: entry.tab!.id }); }}
                              className="rounded bg-blue-50 px-1 py-0.5 text-[9px] text-blue-600 hover:bg-blue-100"
                            >
                              {t('clusters.goToTab')}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); void closeTabs([entry.tab!.id]); }}
                              className="rounded bg-red-50 px-1 py-0.5 text-[9px] text-red-600 hover:bg-red-100"
                            >
                              {t('clusters.closeTab')}
                            </button>
                          </div>
                        ) : entry.url ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="rounded bg-gray-50 px-1 text-[9px] text-gray-400">{t('clusters.notOpen')}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); chrome.runtime.sendMessage({ type: 'OPEN_URL', url: entry.url }); }}
                              className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent hover:bg-accent/20"
                            >
                              {t('clusters.openUrl')}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {matches.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {matches.map(({ saved, overlap }) => (
                    <div key={saved.id} className="rounded border border-green-100 bg-green-50 px-2 py-1 text-[10px] text-green-800">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{saved.name}</span>
                        <span className="text-green-600">{saved.tabUrls.length} URL</span>
                      </div>
                      <div className="mt-0.5 text-green-700">
                        {t('ai.sharedTags')}: {overlap.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 rounded border border-amber-100 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
                  {t('ai.themeComparisonNewTheme')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function openOrFocusTab(tabMap: Map<number, TabRecord>, tabId: number, url: string) {
  const directTab = tabMap.get(tabId) ?? [...tabMap.values()].find((tab) => tab.url === url);
  if (directTab) {
    await chrome.tabs.update(directTab.id, { active: true });
    await chrome.windows.update(directTab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

function TabStatusCoverageCard({
  tabMap,
  onAnalyzeRemaining,
}: {
  tabMap: Map<number, TabRecord>;
  onAnalyzeRemaining: () => void;
}) {
  const { aiTabStatuses, aiStatusSummary, aiTabStatusLoading, aiLoading } = useStore();
  const { t } = useI18n();
  const [filter, setFilter] = useState<'all' | 'cached' | 'analyzed' | 'pending' | 'failed'>('all');
  const [expanded, setExpanded] = useState(false);

  const summary = aiStatusSummary ?? summarizeStatusesLocally(aiTabStatuses);
  const pendingStatuses = aiTabStatuses.filter((status) => status.status === 'pending');
  const pendingDomains = getPendingDomainSummary(pendingStatuses);
  if (!aiTabStatusLoading && summary.total === 0) {
    return null;
  }

  const filteredStatuses = aiTabStatuses
    .filter((status) => {
      if (filter === 'all') return true;
      return status.status === filter;
    })
    .sort((left, right) => {
      const order = { pending: 0, analyzed: 1, cached: 2, failed: 3 } as const;
      const statusDelta = order[left.status] - order[right.status];
      if (statusDelta !== 0) return statusDelta;
      return (right.analyzedAt ?? 0) - (left.analyzedAt ?? 0);
    });

  const visibleStatuses = expanded ? filteredStatuses : filteredStatuses.slice(0, 12);

  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="font-medium text-gray-800">{t('ai.tabCoverage')}</p>
          <p className="text-[10px] text-gray-500">{t('ai.tabCoverageHint')}</p>
        </div>
        {aiTabStatusLoading && (
          <span className="text-[10px] text-gray-400">{t('ai.analyzing')}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
        <div className="rounded bg-blue-50 px-2 py-1 text-blue-700">{t('ai.fromCache')}: {summary.cached}</div>
        <div className="rounded bg-green-50 px-2 py-1 text-green-700">{t('ai.newTabs')}: {summary.analyzed}</div>
        <div className="rounded bg-gray-50 px-2 py-1 text-gray-600">{t('ai.remaining')}: {summary.pending}</div>
        <div className="rounded bg-red-50 px-2 py-1 text-red-600">{t('ai.statusFailed')}: {summary.failed}</div>
      </div>

      {pendingStatuses.length > 0 && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-2.5 py-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-amber-800">{t('ai.missingCoverageTitle')} ({pendingStatuses.length})</p>
              <p className="text-[10px] text-amber-700">{t('ai.missingCoverageHint')}</p>
            </div>
            <button
              onClick={onAnalyzeRemaining}
              disabled={aiLoading}
              className="shrink-0 rounded bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-800 hover:bg-amber-200 disabled:opacity-50"
            >
              {t('ai.analyze')}
            </button>
          </div>
          {pendingDomains.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {pendingDomains.map(([domain, count]) => (
                <span key={domain} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-amber-800">
                  {domain} · {count}
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 space-y-1">
            {pendingStatuses.slice(0, expanded && filter === 'pending' ? pendingStatuses.length : 8).map((status) => (
              <div key={`pending:${status.tabId}:${status.url}`} className="rounded bg-white px-2 py-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => void openOrFocusTab(tabMap, status.tabId, status.url)}
                      className="block w-full truncate text-left text-[11px] font-medium text-gray-700 hover:text-accent hover:underline"
                    >
                      {status.title || status.url}
                    </button>
                    <button
                      onClick={() => void openOrFocusTab(tabMap, status.tabId, status.url)}
                      className="mt-0.5 block w-full truncate text-left text-[10px] text-accent hover:underline"
                    >
                      {status.url}
                    </button>
                    <div className="mt-0.5 text-[10px] text-gray-500">{t('ai.pendingReason')}</div>
                  </div>
                  <button
                    onClick={() => void openOrFocusTab(tabMap, status.tabId, status.url)}
                    className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700 hover:bg-gray-200"
                  >
                    {t('ai.open')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {([
          ['all', t('ai.statusFilterAll')],
          ['cached', t('ai.fromCache')],
          ['analyzed', t('ai.newTabs')],
          ['pending', t('ai.remaining')],
          ['failed', t('ai.statusFailed')],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`rounded px-2 py-0.5 text-[10px] ${
              filter === value ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-2 space-y-1">
        {visibleStatuses.length === 0 ? (
          <div className="text-[11px] text-gray-400">{t('ai.statusNoTabs')}</div>
        ) : (
          visibleStatuses.map((status) => {
            const badge = getTabStatusBadge(status, t);
            return (
              <div key={`${status.tabId}:${status.url}`} className="rounded bg-gray-50 px-2 py-1.5">
                <div className="flex items-start gap-2">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${status.domain}&sz=16`}
                    alt=""
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => void openOrFocusTab(tabMap, status.tabId, status.url)}
                      className="block w-full truncate text-left text-[11px] font-medium text-gray-700 hover:text-accent hover:underline"
                    >
                      {status.title || status.url}
                    </button>
                    <button
                      onClick={() => void openOrFocusTab(tabMap, status.tabId, status.url)}
                      className="mt-0.5 block w-full truncate text-left text-[10px] text-accent hover:underline"
                    >
                      {status.url}
                    </button>
                    {status.reason && (
                      <div className="mt-0.5 truncate text-[10px] text-gray-500">{status.reason}</div>
                    )}
                    {!status.reason && status.status === 'pending' && (
                      <div className="mt-0.5 truncate text-[10px] text-gray-500">{t('ai.pendingReason')}</div>
                    )}
                    {status.analyzedAt && (
                      <div className="mt-0.5 text-[9px] text-gray-400">
                        {t('ai.lastAnalyzedAt')}: {formatStatusTime(status.analyzedAt)}
                      </div>
                    )}
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {filteredStatuses.length > 12 && (
        <button
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-[10px] font-medium text-accent hover:underline"
        >
          {expanded ? t('ai.showLessStatuses') : `${t('ai.showMoreStatuses')} (${filteredStatuses.length - 12})`}
        </button>
      )}
    </div>
  );
}

function RecommendationList({
  recommendations,
  tabMap,
  statusByTabId,
  onOpenTab,
  onClose,
}: {
  recommendations: TabRecommendation[];
  tabMap: Map<number, TabRecord>;
  statusByTabId: Map<number, TabAnalysisStatus>;
  onOpenTab: (tabId: number, url: string) => void;
  onClose: (tabId: number) => void;
}) {
  const { t } = useI18n();
  const [expandedSections, setExpandedSections] = useState<Record<RecommendedAction, boolean>>({
    close: true,
    group: false,
    read_later: false,
    archive: false,
    keep: false,
  });

  return (
    <>
      {(['close', 'group', 'read_later', 'archive', 'keep'] as RecommendedAction[]).map((action) => {
        const recs = recommendations.filter((r) => r.action === action);
        if (recs.length === 0) return null;
        const isExpanded = expandedSections[action];
        return (
          <div key={action} className="rounded border border-gray-100 bg-white">
            <button
              onClick={() => setExpandedSections((current) => ({ ...current, [action]: !current[action] }))}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
            >
              <span className={`px-1.5 py-0.5 rounded ${ACTION_COLORS[action]}`}>
                {t(ACTION_LABELS[action] as 'ai.keep')}
              </span>
              <span className="text-xs font-medium text-gray-700">{recs.length}</span>
              <span className="text-[10px] text-gray-400">{t('ai.recommendationsSectionHint')}</span>
              <span className="ml-auto text-gray-300">{isExpanded ? '▼' : '▶'}</span>
            </button>
            {isExpanded && (
              <div className="flex flex-col gap-0.5 border-t border-gray-100 px-2 py-1.5">
                {recs.map((rec) => {
                const tab = tabMap.get(rec.tabId);
                if (!tab) return null;
                const status = statusByTabId.get(rec.tabId);
                const sourceBadge = status ? getTabStatusBadge(status, t) : null;
                return (
                  <div
                    key={rec.tabId}
                    className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-surface-hover text-xs"
                  >
                    <img
                      src={tab.favIconUrl ?? `https://www.google.com/s2/favicons?domain=${tab.domain}&sz=16`}
                      alt=""
                      className="mt-0.5 w-3.5 h-3.5 shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => onOpenTab(tab.id, tab.url)}
                        className="block w-full truncate text-left text-gray-700 hover:text-accent hover:underline"
                      >
                        {tab.title}
                      </button>
                      <button
                        onClick={() => onOpenTab(tab.id, tab.url)}
                        className="block w-full truncate text-left text-[10px] text-accent hover:underline"
                      >
                        {tab.url}
                      </button>
                      <div className="mt-0.5 truncate text-gray-500 text-[10px]">
                        {rec.reason} · {Math.round(rec.confidence * 100)}%
                      </div>
                      {sourceBadge && (
                        <div className="mt-1">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sourceBadge.className}`}>
                            {sourceBadge.label}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => onOpenTab(tab.id, tab.url)}
                        className="px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                      >
                        {t('chat.goToTab')}
                      </button>
                      <button
                        onClick={() => onClose(rec.tabId)}
                        className="px-1.5 py-0.5 text-[10px] rounded bg-red-50 text-red-600 hover:bg-red-100"
                      >
                        {t('chat.closeTab')}
                      </button>
                    </div>
                  </div>
                );
              })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function AIRecommendations() {
  const {
    aiResult,
    aiLoading,
    aiError,
    aiMetadata,
    aiWasCanceled,
    aiResumeAvailable,
    aiProgress,
    aiTabStatuses,
    aiStatusSummary,
    analyzeTabs,
    resumeAIAnalysis,
    stopAIAnalysis,
    loadAIResult,
    loadAITabStatuses,
    startCleanupSession,
    closeTabs,
    windowGroups,
    focusClusterId,
    focusClusterName,
    focusMatchedTabIds,
    setFocusMode,
    exitFocusMode,
    insights,
    habitsScore,
    recStats,
    heatmap,
    persistentClusters,
    persistentClustersLoading,
    analyticsRefreshing,
    analyticsRefreshError,
    analyticsInsight,
    loadAnalytics,
    loadPersistentClusters,
    loadHeatmap,
    refreshAnalytics,
  } = useStore();
  const { t } = useI18n();
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'analysis' | 'analytics'>('analysis');
  const [showInsights, setShowInsights] = useState(false);
  const [heatmapDomain, setHeatmapDomain] = useState('');
  const [showPersistentClusters, setShowPersistentClusters] = useState(false);
  const [editingClusterId, setEditingClusterId] = useState<number | null>(null);
  const [editingClusterName, setEditingClusterName] = useState('');
  const [expandedPersistentClusterId, setExpandedPersistentClusterId] = useState<number | null>(null);

  useEffect(() => {
    void loadAIResult();
    void loadAITabStatuses();
  }, [loadAIResult, loadAITabStatuses]);

  useEffect(() => {
    if (windowGroups.length > 0 && !aiLoading) {
      void loadAITabStatuses();
    }
  }, [windowGroups, aiLoading, loadAITabStatuses]);

  useEffect(() => {
    if (activeSection === 'analytics') {
      loadAnalytics();
      if (persistentClusters.length === 0 && !persistentClustersLoading) {
        loadPersistentClusters();
      }
    }
  }, [activeSection, showInsights, loadAnalytics, persistentClusters.length, persistentClustersLoading, loadPersistentClusters]);

  const allTabs = windowGroups.flatMap((wg) => wg.tabs);
  const tabMap = new Map(allTabs.map((tab) => [tab.id, tab]));
  const statusByTabId = new Map(aiTabStatuses.map((status) => [status.tabId, status]));
  const statusSummary = aiStatusSummary ?? summarizeStatusesLocally(aiTabStatuses);
  const pendingDomains = getPendingDomainSummary(aiTabStatuses.filter((status) => status.status === 'pending'));

  function handleOpenTab(tabId: number, url: string) {
    void openOrFocusTab(tabMap, tabId, url);
  }

  async function handleExportCluster(cluster: TopicCluster) {
    const clusterTabs = cluster.tabIds
      .map((id) => tabMap.get(id))
      .filter((tab): tab is TabRecord => tab !== undefined);
    await exportTopicCluster(cluster, clusterTabs);
  }

  async function handleRenameCluster(clusterId: number, name: string) {
    await chrome.runtime.sendMessage({ type: 'RENAME_CLUSTER', clusterId, name });
    setEditingClusterId(null);
    loadPersistentClusters();
  }

  async function handleDeleteCluster(clusterId: number) {
    await chrome.runtime.sendMessage({ type: 'DELETE_CLUSTER', clusterId });
    loadPersistentClusters();
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      {focusClusterId !== null && (
        <div className="flex items-center gap-2 rounded bg-cyan-50 px-3 py-2 text-xs">
          <span className="font-medium text-cyan-700">
            {t('focus.active')}: {focusClusterName}
          </span>
          <span className="text-cyan-500">
            — {focusMatchedTabIds.length} {t('focus.tabsGrouped')}
          </span>
          <button
            onClick={() => void exitFocusMode()}
            className="ml-auto rounded bg-cyan-100 px-2 py-0.5 text-[10px] text-cyan-700 hover:bg-cyan-200"
          >
            {t('focus.exitFocus')}
          </button>
        </div>
      )}

      {aiStatusSummary && aiStatusSummary.pending > 0 && !aiLoading && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="text-xs font-medium text-amber-800">
            {t('ai.newTabsBanner').replace('{count}', String(aiStatusSummary.pending))}
          </span>
          <button
            onClick={() => analyzeTabs()}
            className="ml-2 shrink-0 rounded bg-amber-500 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-amber-600"
          >
            {t('ai.analyzeNewTabs')}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">{t('ai.title')}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => analyzeTabs()}
            disabled={aiLoading}
            className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {aiLoading ? t('ai.analyzing') : t('ai.analyze')}
          </button>
          <button
            onClick={() => {
              if (window.confirm(t('ai.refreshConfirm'))) {
                analyzeTabs(true);
              }
            }}
            disabled={aiLoading}
            className="rounded bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-200 disabled:opacity-50"
          >
            ↻ {t('ai.reanalyze')}
          </button>
          <button
            onClick={() => void stopAIAnalysis()}
            disabled={!aiLoading}
            className="rounded bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600 disabled:opacity-40"
          >
            {t('ai.stop')}
          </button>
          {aiWasCanceled && aiResumeAvailable && (
            <button
              onClick={resumeAIAnalysis}
              disabled={aiLoading}
              className="rounded bg-amber-500 px-3 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-40"
            >
              {t('ai.resume')}
            </button>
          )}
        </div>
      </div>

      {aiError && (
        <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">
          {aiError}
          <button onClick={() => analyzeTabs()} className="ml-2 underline">
            {t('ai.retry')}
          </button>
        </div>
      )}

      <div className="flex gap-2 rounded border border-gray-200 bg-white p-1">
        <button
          onClick={() => setActiveSection('analysis')}
          className={`flex-1 rounded px-3 py-1.5 text-xs font-medium ${
            activeSection === 'analysis'
              ? 'bg-accent text-white'
              : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
          }`}
        >
          {t('ai.sectionAnalysis')}
        </button>
        <button
          onClick={() => setActiveSection('analytics')}
          className={`flex-1 rounded px-3 py-1.5 text-xs font-medium ${
            activeSection === 'analytics'
              ? 'bg-accent text-white'
              : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
          }`}
        >
          {t('ai.sectionAnalytics')}
        </button>
      </div>

      {activeSection === 'analysis' && (
        <>
          {(aiLoading || (aiWasCanceled && Boolean(aiProgress))) && <AnalysisProgress />}
          {(aiLoading || Boolean(aiMetadata?.providerStatus)) && <RuntimeStatusCard />}
          {(aiTabStatuses.length > 0 || aiLoading) && (
            <TabStatusCoverageCard
              tabMap={tabMap}
              onAnalyzeRemaining={() => analyzeTabs()}
            />
          )}

          {aiResult && (
            <>
              {!aiLoading && <AnalysisMetadataBar />}

              {aiLoading && (
                <div className="rounded bg-blue-50 px-3 py-2 text-[11px] text-blue-700">
                  {t('ai.partialResults')}
                </div>
              )}

              {!aiLoading && aiWasCanceled && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                  {t('ai.canceled')}
                  {aiResumeAvailable && (
                    <button
                      onClick={resumeAIAnalysis}
                      className="ml-2 font-medium underline"
                    >
                      {t('ai.resume')}
                    </button>
                  )}
                </div>
              )}

              <SuggestedNextSteps
                aiResult={aiResult}
                statusSummary={statusSummary}
                pendingDomains={pendingDomains}
                tabMap={tabMap}
                onAnalyzeRemaining={() => analyzeTabs()}
                onStartCleanup={() => { void startCleanupSession(); }}
              />

              <div className="rounded bg-surface-hover px-3 py-2 text-xs text-gray-700">
                <p className="mb-1 font-medium">{t('ai.summary')}</p>
                <p>{aiResult.summary}</p>
                {aiResult.sessionStats.actionBreakdown && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(['close', 'archive', 'read_later', 'group', 'keep'] as RecommendedAction[]).map((action) => {
                      const count = aiResult.sessionStats.actionBreakdown?.[action];
                      if (!count) return null;
                      return (
                        <span key={action} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ACTION_COLORS[action]}`}>
                          {t(ACTION_LABELS[action] as 'ai.keep')} {count}
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="mt-2 flex gap-3 text-gray-500">
                  <span>{t('ai.themes')}: {aiResult.sessionStats.mainThemes.join(', ') || '—'}</span>
                </div>
              </div>

              {!aiLoading && (
                <button
                  onClick={startCleanupSession}
                  className="w-full rounded bg-orange-500 py-2 text-xs text-white transition-colors hover:bg-orange-600"
                >
                  {t('ai.startCleanup')}
                </button>
              )}

              <RecommendationList
                recommendations={aiResult.tabRecommendations}
                tabMap={tabMap}
                statusByTabId={statusByTabId}
                onOpenTab={handleOpenTab}
                onClose={(tabId) => closeTabs([tabId])}
              />

              {aiResult.topicClusters.length > 0 && (
                <div className="rounded border border-gray-200 bg-white px-3 py-2">
                  <h3 className="mb-2 text-xs font-medium text-gray-600">{t('ai.clusters')}</h3>
                  <div className="space-y-1">
                    {aiResult.topicClusters.map((cluster) => (
                      <div key={cluster.name} className="rounded bg-gray-50">
                        <button
                          onClick={() => setExpandedCluster(expandedCluster === cluster.name ? null : cluster.name)}
                          className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-surface-hover"
                        >
                          <span className="font-medium text-gray-700">{cluster.name}</span>
                          <span className="text-gray-400">({cluster.tabIds.length})</span>
                          <span className="ml-auto text-gray-300">{expandedCluster === cluster.name ? '▼' : '▶'}</span>
                        </button>
                        {expandedCluster === cluster.name && (
                          <div className="space-y-1 px-4 pb-2">
                            <p className="text-[10px] text-gray-500">{cluster.description}</p>
                            {cluster.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {cluster.tags.map((tag) => (
                                  <span key={`${cluster.name}:${tag}`} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-600">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="max-h-48 space-y-0.5 overflow-y-auto">
                              {cluster.tabIds.map((id) => {
                                const tab = tabMap.get(id);
                                const status = statusByTabId.get(id);
                                const fallbackUrl = tab?.url ?? status?.url ?? cluster.tabUrls?.[cluster.tabIds.indexOf(id)];
                                const currentTab = tab ?? (fallbackUrl ? allTabs.find((t) => t.url === fallbackUrl) : undefined);
                                if (!currentTab && !fallbackUrl) return null;
                                const displayUrl = currentTab?.url ?? fallbackUrl ?? '';
                                const displayTitle = currentTab?.title ?? status?.title ?? displayUrl;
                                const domain = (() => { try { return new URL(displayUrl).hostname; } catch { return ''; } })();
                                const isOpen = currentTab !== undefined;
                                return (
                                  <div key={id} className="flex items-center gap-1.5 rounded bg-white px-1.5 py-1">
                                    <img
                                      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                                      alt=""
                                      className="h-3 w-3 shrink-0"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                    <span className="min-w-0 flex-1 truncate text-[10px] text-gray-700" title={displayUrl}>
                                      {displayTitle}
                                    </span>
                                    {isOpen ? (
                                      <div className="flex shrink-0 items-center gap-1">
                                        <span className="rounded bg-green-50 px-1 text-[9px] text-green-600">Open</span>
                                        <button
                                          onClick={() => handleOpenTab(currentTab.id, currentTab.url)}
                                          className="rounded bg-blue-50 px-1 py-0.5 text-[9px] text-blue-600 hover:bg-blue-100"
                                        >
                                          {t('clusters.goToTab')}
                                        </button>
                                        <button
                                          onClick={() => closeTabs([currentTab.id])}
                                          className="rounded bg-red-50 px-1 py-0.5 text-[9px] text-red-600 hover:bg-red-100"
                                        >
                                          {t('clusters.closeTab')}
                                        </button>
                                      </div>
                                    ) : displayUrl ? (
                                      <div className="flex shrink-0 items-center gap-1">
                                        <span className="rounded bg-gray-50 px-1 text-[9px] text-gray-400">{t('clusters.notOpen')}</span>
                                        <button
                                          onClick={() => chrome.runtime.sendMessage({ type: 'OPEN_URL', url: displayUrl })}
                                          className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent hover:bg-accent/20"
                                        >
                                          {t('clusters.openUrl')}
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="mt-1 flex gap-1">
                              <button
                                onClick={() => void chrome.runtime.sendMessage({ type: 'GROUP_TABS_BY_CLUSTER', tabIds: cluster.tabIds, name: cluster.name })}
                                className="rounded bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600 hover:bg-blue-100"
                              >
                                {t('clusters.groupTabs')}
                              </button>
                              <button
                                onClick={() => handleExportCluster(cluster)}
                                className="rounded bg-purple-50 px-2 py-0.5 text-[10px] text-purple-600 hover:bg-purple-100"
                              >
                                {t('clusters.exportObsidian')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {activeSection === 'analytics' && (
        <>
          <div className="flex items-center justify-end">
            <button
              onClick={() => void refreshAnalytics()}
              disabled={analyticsRefreshing}
              className="flex items-center gap-1.5 rounded bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-200 disabled:opacity-70"
            >
              {analyticsRefreshing ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-purple-300 border-t-purple-600" />
                  {t('ai.updatingInsights')}
                </>
              ) : (
                <>✦ {t('ai.updateInsights')}</>
              )}
            </button>
          </div>

          {analyticsRefreshError && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {analyticsRefreshError}
            </div>
          )}

          {analyticsInsight && (
            <div className="space-y-2 rounded border border-purple-200 bg-purple-50 px-3 py-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-purple-800">{t('ai.aiInsight')}</p>
                <span className="text-[10px] text-purple-500">
                  {analyticsInsight.providerUsed ?? ''}{analyticsInsight.modelUsed ? ` · ${analyticsInsight.modelUsed}` : ''}
                </span>
              </div>
              <p className="text-xs text-gray-700">{analyticsInsight.browsingPatterns}</p>
              {analyticsInsight.suggestions.length > 0 && (
                <ul className="list-disc pl-4 text-xs text-gray-600">
                  {analyticsInsight.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
              {analyticsInsight.habitsCommentary && (
                <p className="text-[11px] italic text-gray-500">{analyticsInsight.habitsCommentary}</p>
              )}
              {analyticsInsight.clusterInsights.length > 0 && (
                <div className="space-y-1 border-t border-purple-100 pt-1.5">
                  {analyticsInsight.clusterInsights.map((ci, i) => (
                    <div key={i} className="text-[11px]">
                      <span className="font-medium text-purple-700">{ci.clusterName}:</span>{' '}
                      <span className="text-gray-600">{ci.insight}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <AnalyticsSnapshotCard
            aiResult={aiResult}
            insights={insights}
            habitsScore={habitsScore}
            recStats={recStats}
            showInsights={showInsights}
            onToggle={() => setShowInsights(!showInsights)}
          />

          <ThemeComparisonCard
            topicClusters={aiResult?.topicClusters ?? []}
            persistentClusters={persistentClusters}
            loading={persistentClustersLoading}
            windowGroups={windowGroups}
            closeTabs={closeTabs}
          />

          {showInsights && insights && (
            <div className="space-y-3 rounded border border-gray-200 bg-white px-3 pb-3">
              <div className="pt-3" />
              {insights.topDomains.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-gray-700">{t('ai.topDomains')}</p>
                  <div className="space-y-0.5">
                    {insights.topDomains.map((d) => {
                      const maxCount = insights.topDomains[0].count;
                      const widthPercent = Math.max(8, (d.count / maxCount) * 100);
                      return (
                        <div key={d.domain} className="flex items-center gap-2 text-[11px]">
                          <span className="w-28 truncate text-gray-600">{d.domain}</span>
                          <div className="h-3 flex-1 overflow-hidden rounded bg-gray-100">
                            <div
                              className="h-full rounded bg-accent"
                              style={{ width: `${widthPercent}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-[10px] text-gray-400">{d.count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {insights.avgAnalysisStats.totalSessions > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-gray-700">{t('ai.avgStats')}</p>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="rounded bg-gray-50 px-2 py-1">
                      <span className="text-gray-400">{t('ai.avgTabs')}:</span>{' '}
                      <span className="font-medium text-gray-700">{insights.avgAnalysisStats.avgTabs}</span>
                    </div>
                    <div className="rounded bg-gray-50 px-2 py-1">
                      <span className="text-gray-400">{t('ai.avgDuration')}:</span>{' '}
                      <span className="font-medium text-gray-700">{(insights.avgAnalysisStats.avgDurationMs / 1000).toFixed(1)}s</span>
                    </div>
                    {insights.avgAnalysisStats.avgCost != null && (
                      <div className="rounded bg-gray-50 px-2 py-1">
                        <span className="text-gray-400">{t('ai.avgCost')}:</span>{' '}
                        <span className="font-medium text-gray-700">${insights.avgAnalysisStats.avgCost.toFixed(4)}</span>
                      </div>
                    )}
                    <div className="rounded bg-gray-50 px-2 py-1">
                      <span className="text-gray-400">{t('ai.totalSessions')}:</span>{' '}
                      <span className="font-medium text-gray-700">{insights.avgAnalysisStats.totalSessions}</span>
                    </div>
                  </div>
                </div>
              )}

              {insights.snapshotTrend.length > 1 && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-gray-700">{t('ai.snapshotTrend')}</p>
                  <div className="flex h-12 items-end gap-0.5">
                    {insights.snapshotTrend.map((s, i) => {
                      const maxTabs = Math.max(...insights.snapshotTrend.map((x) => x.tabCount));
                      const heightPercent = maxTabs > 0 ? Math.max(4, (s.tabCount / maxTabs) * 100) : 4;
                      return (
                        <div
                          key={i}
                          className="flex-1 rounded-t bg-accent"
                          style={{ height: `${heightPercent}%` }}
                          title={`${s.tabCount} tabs`}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-gray-300">
                    <span>{new Date(insights.snapshotTrend[0].timestamp).toLocaleDateString()}</span>
                    <span>{new Date(insights.snapshotTrend[insights.snapshotTrend.length - 1].timestamp).toLocaleDateString()}</span>
                  </div>
                </div>
              )}

              {habitsScore && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-gray-700">{t('habits.title')}</p>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-sm font-bold ${
                      habitsScore.score >= 70 ? 'border-green-400 bg-green-50 text-green-700'
                        : habitsScore.score >= 40 ? 'border-yellow-400 bg-yellow-50 text-yellow-700'
                          : 'border-red-400 bg-red-50 text-red-700'
                    }`}>
                      {habitsScore.score}
                    </div>
                    <div className="flex-1">
                      <span className={`text-[11px] font-medium ${
                        habitsScore.trend === 'improving' ? 'text-green-600'
                          : habitsScore.trend === 'declining' ? 'text-red-600'
                            : 'text-gray-500'
                      }`}>
                        {habitsScore.trend === 'improving' ? '↑' : habitsScore.trend === 'declining' ? '↓' : '→'}{' '}
                        {t(`habits.${habitsScore.trend}` as 'habits.improving')}
                      </span>
                      <div className="mt-1 space-y-0.5">
                        {habitsScore.components.map((c) => (
                          <div key={c.name} className="flex items-center gap-1.5 text-[10px]">
                            <span className="w-24 truncate text-gray-500">{t(`habits.${c.name}` as 'habits.closablePercent')}</span>
                            <div className="h-1.5 flex-1 rounded bg-gray-100">
                              <div
                                className={`h-full rounded ${c.normalizedScore >= 60 ? 'bg-green-400' : c.normalizedScore >= 30 ? 'bg-yellow-400' : 'bg-red-400'}`}
                                style={{ width: `${c.normalizedScore}%` }}
                              />
                            </div>
                            <span className="w-6 text-right text-[9px] text-gray-400">{Math.round(c.normalizedScore)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {recStats && recStats.totalActions > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-gray-700">{t('recommendations.stats')}</p>
                  <div className="space-y-1 text-[11px] text-gray-600">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">{t('recommendations.acceptanceRate')}:</span>
                      <span className="font-medium">{Math.round(recStats.acceptanceRate * 100)}%</span>
                      <span className="text-[10px] text-gray-400">({recStats.totalActions} total)</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(recStats.byAiAction).map(([action, stats]) => (
                        <div key={action} className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px]">
                          <span className="font-medium">{action}</span>:{' '}
                          <span className="text-green-600">{stats.accepted}</span>/
                          <span className="text-gray-400">{stats.total}</span>
                        </div>
                      ))}
                    </div>
                    {recStats.confidenceCorrelation.length > 0 && (
                      <div className="mt-1">
                        <span className="text-[10px] text-gray-400">{t('recommendations.byConfidence')}:</span>
                        <div className="mt-0.5 flex gap-1">
                          {recStats.confidenceCorrelation.map((b) => (
                            <div key={b.bucket} className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px]">
                              {b.bucket}: <span className="font-medium">{Math.round(b.acceptanceRate * 100)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {heatmap && (
                <div className="pb-3">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[11px] font-medium text-gray-700">{t('heatmap.title')}</p>
                    <select
                      value={heatmapDomain}
                      onChange={(e) => {
                        setHeatmapDomain(e.target.value);
                        loadHeatmap(e.target.value || undefined);
                      }}
                      className="rounded border border-gray-200 px-1 py-0.5 text-[10px]"
                    >
                      <option value="">{t('heatmap.allDomains')}</option>
                      {heatmap.domains.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  {(() => {
                    const maxVal = Math.max(...heatmap.grid.flat(), 1);
                    const dayKeys = ['heatmap.sun', 'heatmap.mon', 'heatmap.tue', 'heatmap.wed', 'heatmap.thu', 'heatmap.fri', 'heatmap.sat'] as const;
                    return (
                      <div className="space-y-px">
                        <div className="ml-6 flex gap-px">
                          {[0, 6, 12, 18].map((h) => (
                            <span key={h} className="text-[8px] text-gray-300" style={{ width: h === 0 ? '0px' : undefined, marginLeft: h === 0 ? 0 : `${(h - (h === 6 ? 0 : h === 12 ? 6 : 12)) * 12}px` }}>
                              {h}h
                            </span>
                          ))}
                        </div>
                        {heatmap.grid.map((row, dayIdx) => (
                          <div key={dayIdx} className="flex items-center gap-1">
                            <span className="w-5 text-right text-[9px] text-gray-400">{t(dayKeys[dayIdx])}</span>
                            <div className="flex gap-px">
                              {row.map((val, hourIdx) => {
                                const intensity = val / maxVal;
                                const bg = val === 0 ? '#f3f4f6' : `hsl(142, ${40 + intensity * 40}%, ${85 - intensity * 45}%)`;
                                return (
                                  <div
                                    key={hourIdx}
                                    className="h-2.5 w-2.5 rounded-sm"
                                    style={{ backgroundColor: bg }}
                                    title={`${t(dayKeys[dayIdx])} ${hourIdx}:00 — ${val} events`}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          <div className="rounded border border-gray-200 bg-white px-3 py-2">
            <button
              onClick={() => {
                const next = !showPersistentClusters;
                setShowPersistentClusters(next);
                if (next && persistentClusters.length === 0) loadPersistentClusters();
              }}
              className="text-xs font-medium text-accent hover:underline"
            >
              {showPersistentClusters ? `▼ ${t('clusters.persistent')}` : `▶ ${t('clusters.persistent')}`}
            </button>

            {showPersistentClusters && (
              <div className="mt-2">
                {persistentClusters.length === 0 ? (
                  <p className="text-[11px] text-gray-400">{t('clusters.noPersistent')}</p>
                ) : (
                  <div className="space-y-1">
                    {persistentClusters.map((pc) => {
                      const isExpanded = expandedPersistentClusterId === pc.id;
                      const allTabs = windowGroups.flatMap((wg) => wg.tabs);
                      const urlEntries = isExpanded ? pc.tabUrls.map((url) => {
                        const normUrl = url.toLowerCase().replace(/\/+$/, '');
                        const matchedTab = allTabs.find((tab) => tab.url.toLowerCase().replace(/\/+$/, '') === normUrl);
                        const domain = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
                        return { url, domain, title: matchedTab?.title ?? url, tabId: matchedTab?.id ?? null, isOpen: !!matchedTab };
                      }) : [];
                      const openCount = isExpanded ? urlEntries.filter((e) => e.isOpen).length : 0;
                      return (
                      <div key={pc.id} className="rounded bg-surface-hover px-2 py-1.5 text-xs">
                        <div
                          className="flex cursor-pointer items-center gap-2"
                          onClick={() => setExpandedPersistentClusterId(isExpanded ? null : pc.id)}
                        >
                          <span className="text-[10px] text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                          {editingClusterId === pc.id ? (
                            <input
                              className="flex-1 rounded border px-1 py-0.5 text-xs"
                              value={editingClusterName}
                              onChange={(e) => setEditingClusterName(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleRenameCluster(pc.id, editingClusterName);
                                if (e.key === 'Escape') setEditingClusterId(null);
                              }}
                              autoFocus
                            />
                          ) : (
                            <span className="flex-1 truncate font-medium text-gray-700">{pc.name}</span>
                          )}
                          <span className="text-[10px] text-gray-400">{pc.tabUrls.length} {t('clusters.urlCount')}</span>
                        </div>
                        {pc.description && (
                          <p className="mt-0.5 truncate text-[10px] text-gray-500">{pc.description}</p>
                        )}
                        {pc.tags.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {pc.tags.slice(0, 5).map((tag) => (
                              <span key={tag} className="rounded bg-gray-100 px-1 text-[9px] text-gray-500">{tag}</span>
                            ))}
                          </div>
                        )}
                        {isExpanded && (
                          <div className="mt-1.5 space-y-1 border-t border-gray-200 pt-1.5">
                            <div className="text-[10px] text-gray-400">
                              {t('clusters.openCount').replace('{open}', String(openCount)).replace('{total}', String(pc.tabUrls.length))}
                            </div>
                            <div className="max-h-48 space-y-0.5 overflow-y-auto">
                              {urlEntries.map((entry) => {
                                const domain = entry.domain;
                                return (
                                  <div key={entry.url} className="flex items-center gap-1.5 rounded bg-white px-1.5 py-1">
                                    <img
                                      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                                      alt=""
                                      className="h-3 w-3 shrink-0"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                    <span className="min-w-0 flex-1 truncate text-[10px] text-gray-700" title={entry.url}>
                                      {entry.title}
                                    </span>
                                    {entry.isOpen ? (
                                      <div className="flex shrink-0 items-center gap-1">
                                        <span className="rounded bg-green-50 px-1 text-[9px] text-green-600">Open</span>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); if (entry.tabId) chrome.runtime.sendMessage({ type: 'FOCUS_TAB', tabId: entry.tabId }); }}
                                          className="rounded bg-blue-50 px-1 py-0.5 text-[9px] text-blue-600 hover:bg-blue-100"
                                        >
                                          {t('clusters.goToTab')}
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); if (entry.tabId) closeTabs([entry.tabId]); }}
                                          className="rounded bg-red-50 px-1 py-0.5 text-[9px] text-red-600 hover:bg-red-100"
                                        >
                                          {t('clusters.closeTab')}
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex shrink-0 items-center gap-1">
                                        <span className="rounded bg-gray-50 px-1 text-[9px] text-gray-400">{t('clusters.notOpen')}</span>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); chrome.runtime.sendMessage({ type: 'OPEN_URL', url: entry.url }); }}
                                          className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent hover:bg-accent/20"
                                        >
                                          {t('clusters.openUrl')}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="mt-1 flex gap-1">
                          <button
                            onClick={() => void setFocusMode(pc.id)}
                            className="rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] text-cyan-600 hover:bg-cyan-100"
                          >
                            {t('focus.focusOnTopic')}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingClusterId(pc.id); setEditingClusterName(pc.name); }}
                            className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100"
                          >
                            {t('clusters.rename')}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); if (confirm(t('clusters.confirmDelete'))) void handleDeleteCluster(pc.id); }}
                            className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-500 hover:bg-red-100"
                          >
                            {t('clusters.delete')}
                          </button>
                          <span className="ml-auto text-[9px] text-gray-300">
                            {t('clusters.lastUpdated')}: {new Date(pc.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {!aiResult && !aiLoading && !aiError && (
        <p className="py-8 text-center text-xs text-gray-400">{t('ai.noResult')}</p>
      )}
    </div>
  );
}
