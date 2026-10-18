import { describe, expect, it } from 'vitest';
import { buildOptimizationPlan, optimizationMarkdown } from '../optimization';
import { buildDuplicatePreview } from '../duplicates';
import { makeTab } from './fixtures';
import type { ContentReviewPreview } from '@shared/types/content-review';

const tabs = [makeTab({ id: 1, url: 'https://a.test/one' }), makeTab({ id: 2, url: 'https://b.test/two' })];
const review = (relation: 'redundant' | 'related', withExcerpts: boolean): ContentReviewPreview => ({
  id: 'review', createdAt: Date.now(), tabs, similarGroups: [{ id: 'g', tabIds: [1, 2], keepTabId: 1, reason: 'Same release content', confidence: .99, source: 'ai', relation }],
  outdatedTabs: [], protectedDomains: [], extractedCount: withExcerpts ? 2 : 0, extractionFailed: 0, aiTabCount: 2, excerptTabIds: withExcerpts ? [1, 2] : [],
});

describe('quality-preserving optimization planning', () => {
  it('never recommends closing complementary authors or title-only matches', () => {
    expect(buildOptimizationPlan(tabs, buildDuplicatePreview(tabs), review('related', true)).candidates).toEqual([]);
    expect(buildOptimizationPlan(tabs, buildDuplicatePreview(tabs), review('redundant', false)).candidates[0].recommended).toBe(false);
    expect(buildOptimizationPlan(tabs, buildDuplicatePreview(tabs), review('redundant', true)).candidates[0].recommended).toBe(true);
  });
  it('offers obsolete material for explicit choice while preserving its replacement', () => {
    const data = review('related', true);
    data.similarGroups = []; data.outdatedTabs = [{ tabId: 2, replacementTabId: 1, evidence: 'old guide', reason: 'New guide replaces it', confidence: .99 }];
    const plan = buildOptimizationPlan(tabs, buildDuplicatePreview(tabs), data);
    expect(plan.candidates[0]).toMatchObject({ recommended: false, keep: { id: 1 } });
    expect(optimizationMarkdown(plan, [2])).toContain('Forecast after: 1');
  });
  it('ignores AI claims for pages whose title changed after review', () => {
    const changed = tabs.map((tab) => tab.id === 2 ? { ...tab, title: 'A different article' } : tab);
    expect(buildOptimizationPlan(changed, buildDuplicatePreview(changed), review('redundant', true)).candidates).toEqual([]);
  });
});
