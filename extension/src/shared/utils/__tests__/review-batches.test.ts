import { describe, expect, it } from 'vitest';
import { buildReviewBatches } from '../review-batches';
import { makeTab } from './fixtures';

describe('bounded topic-neighbor review batches', () => {
  it('audits all 600 pages once as primary input with no oversized batch', () => {
    const tabs = Array.from({ length: 600 }, (_, index) => makeTab({ id: index, url: `https://example.test/article-${index}`, title: `Reference number ${index}` }));
    const batches = buildReviewBatches(tabs);
    expect(batches).toHaveLength(14);
    expect(batches.every((batch) => batch.tabs.length <= 65 && new Set(batch.tabs.map((tab) => tab.id)).size === batch.tabs.length)).toBe(true);
    expect(batches.flatMap((batch) => batch.primaryIds).sort((a, b) => a - b)).toEqual(tabs.map((tab) => tab.id));
  });
  it('brings specifically related sources together across distant positions and sites', () => {
    const tabs = Array.from({ length: 130 }, (_, index) => makeTab({ id: index, url: `https://site-${index}.test/reference`, title: `Independent source ${index}` }));
    tabs[3].title = 'Postgres vector indexing HNSW benchmark migration';
    tabs[120].title = 'HNSW Postgres vector indexing practical benchmark';
    expect(buildReviewBatches(tabs).some((batch) => batch.tabs.some((tab) => tab.id === 3) && batch.tabs.some((tab) => tab.id === 120))).toBe(true);
  });
  it('keeps small and deep pair reviews to one request without changing supplied content', () => {
    const tabs = [makeTab({ id: 1 }), makeTab({ id: 2 })];
    expect(buildReviewBatches(tabs)).toEqual([{ tabs, primaryIds: [1, 2] }]);
    expect(buildReviewBatches([])).toEqual([]);
  });
});
