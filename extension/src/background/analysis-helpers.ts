import type { AIProgress, TabAnalysisStatus, TabAnalysisStatusSummary } from '@shared/types';

export interface ServerAnalysisRunLike {
  status: 'running' | 'stopped' | 'completed' | 'failed';
  phase: AIProgress['phase'] | 'completed' | 'failed';
  startedAt: number;
  totalTabs: number;
  tabsCached: number;
  tabsAnalyzed: number;
  tabsProcessed: number;
  tabsRemaining: number;
  tabsSaved: number;
  batchesTotal: number;
  batchesCompleted: number;
  currentBatch: number;
  metadata: {
    providerStatus?: AIProgress['providerStatus'];
  };
}

export function computeTabFingerprint(urls: string[]): string {
  const sorted = [...urls].sort();
  const str = sorted.join('\n');
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function createProgressFromRun(snapshot: ServerAnalysisRunLike): AIProgress {
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

export function summarizeTabStatuses(statuses: TabAnalysisStatus[]): TabAnalysisStatusSummary {
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

