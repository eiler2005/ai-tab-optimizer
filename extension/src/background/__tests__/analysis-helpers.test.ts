import { describe, expect, it } from 'vitest';
import { computeTabFingerprint, createProgressFromRun, summarizeTabStatuses } from '../analysis-helpers';

describe('background analysis helpers', () => {
  it('builds an order-insensitive tab fingerprint', () => {
    const a = computeTabFingerprint(['https://b.example', 'https://a.example']);
    const b = computeTabFingerprint(['https://a.example', 'https://b.example']);
    expect(a).toBe(b);
  });

  it('maps completed runs to processing progress for the UI', () => {
    const progress = createProgressFromRun({
      status: 'completed',
      phase: 'completed',
      startedAt: 1,
      totalTabs: 10,
      tabsCached: 3,
      tabsAnalyzed: 7,
      tabsProcessed: 10,
      tabsRemaining: 0,
      tabsSaved: 7,
      batchesTotal: 1,
      batchesCompleted: 1,
      currentBatch: 1,
      metadata: {},
    });

    expect(progress.phase).toBe('processing');
    expect(progress.tabsNew).toBe(7);
  });

  it('summarizes tab analysis states', () => {
    const summary = summarizeTabStatuses([
      { tabId: 1, url: 'https://a', title: 'A', domain: 'a', status: 'cached', source: 'database' },
      { tabId: 2, url: 'https://b', title: 'B', domain: 'b', status: 'analyzed', source: 'provider' },
      { tabId: 3, url: 'https://c', title: 'C', domain: 'c', status: 'failed', source: 'heuristic' },
      { tabId: 4, url: 'https://d', title: 'D', domain: 'd', status: 'pending', source: 'pending' },
    ]);

    expect(summary).toEqual({
      total: 4,
      cached: 1,
      analyzed: 1,
      failed: 1,
      pending: 1,
    });
  });
});
