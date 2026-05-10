import { describe, expect, it } from 'vitest';
import type { TabRecommendation } from '@shared/types';
import { getLiveRecommendations, getRecommendationActionCounts } from '../recommendation-state';

describe('side-panel recommendation state helpers', () => {
  it('filters recommendations down to currently open tabs', () => {
    const recommendations: TabRecommendation[] = [
      { tabId: 1, action: 'close', confidence: 0.9, reason: 'A' },
      { tabId: 2, action: 'group', confidence: 0.8, reason: 'B' },
      { tabId: 3, action: 'keep', confidence: 0.7, reason: 'C' },
    ];

    expect(getLiveRecommendations(recommendations, new Set([1, 3]))).toEqual([
      { tabId: 1, action: 'close', confidence: 0.9, reason: 'A' },
      { tabId: 3, action: 'keep', confidence: 0.7, reason: 'C' },
    ]);
  });

  it('builds a fresh action breakdown from live recommendations', () => {
    const recommendations: TabRecommendation[] = [
      { tabId: 1, action: 'close', confidence: 0.9, reason: 'A' },
      { tabId: 2, action: 'close', confidence: 0.8, reason: 'B' },
      { tabId: 3, action: 'read_later', confidence: 0.7, reason: 'C' },
    ];
    const counts = getRecommendationActionCounts(recommendations);

    expect(counts).toEqual({
      close: 2,
      read_later: 1,
    });
  });
});
