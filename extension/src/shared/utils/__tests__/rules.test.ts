import { describe, it, expect, beforeEach } from 'vitest';
import { runRules } from '../rules';
import { makeTab, resetIdCounter } from './fixtures';

beforeEach(() => {
  resetIdCounter();
});

// ---------------------------------------------------------------------------
// Empty / trivial inputs
// ---------------------------------------------------------------------------

describe('runRules — empty and trivial inputs', () => {
  it('returns empty tabs and zero counts for an empty list', () => {
    const result = runRules([]);
    expect(result.tabs).toHaveLength(0);
    expect(result.duplicateCount).toBe(0);
    expect(result.nearDuplicateCount).toBe(0);
    expect(result.staleCount).toBe(0);
  });

  it('returns a single tab with no flags set', () => {
    const tab = makeTab({ url: 'https://example.com/page' });
    const { tabs, duplicateCount, nearDuplicateCount, staleCount } = runRules([tab]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].ruleFlags?.isExactDuplicate).toBe(false);
    expect(tabs[0].ruleFlags?.isNearDuplicate).toBe(false);
    expect(tabs[0].ruleFlags?.isStale).toBe(false);
    expect(duplicateCount).toBe(0);
    expect(nearDuplicateCount).toBe(0);
    expect(staleCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Exact duplicates
// ---------------------------------------------------------------------------

describe('runRules — exact duplicates', () => {
  it('marks the second tab as exact duplicate of the first', () => {
    const url = 'https://github.com/repo';
    const t1 = makeTab({ id: 1, url });
    const t2 = makeTab({ id: 2, url });
    const { tabs } = runRules([t1, t2]);

    expect(tabs[0].ruleFlags?.isExactDuplicate).toBe(false);
    expect(tabs[1].ruleFlags?.isExactDuplicate).toBe(true);
    expect(tabs[1].ruleFlags?.duplicateOfTabId).toBe(1);
  });

  it('marks all subsequent tabs as duplicates when there are 3 identical URLs', () => {
    const url = 'https://example.com/page';
    const tabs = [1, 2, 3].map((id) => makeTab({ id, url }));
    const { tabs: result, duplicateCount } = runRules(tabs);

    expect(result[0].ruleFlags?.isExactDuplicate).toBe(false);
    expect(result[1].ruleFlags?.isExactDuplicate).toBe(true);
    expect(result[2].ruleFlags?.isExactDuplicate).toBe(true);
    expect(duplicateCount).toBe(2);
  });

  it('treats URLs differing only in tracking params as duplicates', () => {
    const t1 = makeTab({ id: 1, url: 'https://example.com/page' });
    const t2 = makeTab({ id: 2, url: 'https://example.com/page?utm_source=twitter' });
    const { tabs, duplicateCount } = runRules([t1, t2]);

    expect(duplicateCount).toBe(1);
    expect(tabs[1].ruleFlags?.isExactDuplicate).toBe(true);
  });

  it('treats URLs differing only in hash as duplicates', () => {
    const t1 = makeTab({ id: 1, url: 'https://docs.example.com/guide' });
    const t2 = makeTab({ id: 2, url: 'https://docs.example.com/guide#section-3' });
    const { tabs, duplicateCount } = runRules([t1, t2]);

    expect(duplicateCount).toBe(1);
    expect(tabs[1].ruleFlags?.isExactDuplicate).toBe(true);
  });

  it('does not mark tabs on different domains as duplicates', () => {
    const t1 = makeTab({ id: 1, url: 'https://github.com/repo' });
    const t2 = makeTab({ id: 2, url: 'https://gitlab.com/repo' });
    const { duplicateCount } = runRules([t1, t2]);

    expect(duplicateCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Near duplicates
// ---------------------------------------------------------------------------

describe('runRules — near duplicates', () => {
  it('flags two tabs on the same domain with similar paths as near-duplicates', () => {
    // pathSimilarity uses common-prefix-segments / maxSegments > 0.8
    // 5 of 6 segments match → 5/6 ≈ 0.833 > 0.8 → near-duplicate
    const t1 = makeTab({ id: 1, url: 'https://github.com/org/repo/tree/main/src/index.ts' });
    const t2 = makeTab({ id: 2, url: 'https://github.com/org/repo/tree/main/src/utils.ts' });
    const { tabs, nearDuplicateCount } = runRules([t1, t2]);

    expect(tabs[0].ruleFlags?.isNearDuplicate).toBe(true);
    expect(tabs[1].ruleFlags?.isNearDuplicate).toBe(true);
    expect(nearDuplicateCount).toBe(2);
  });

  it('does not flag tabs on different domains as near-duplicates', () => {
    const t1 = makeTab({ id: 1, url: 'https://site-a.com/products/foo' });
    const t2 = makeTab({ id: 2, url: 'https://site-b.com/products/foo' });
    const { nearDuplicateCount } = runRules([t1, t2]);

    expect(nearDuplicateCount).toBe(0);
  });

  it('does not count exact duplicates as near-duplicates', () => {
    const url = 'https://example.com/page';
    const t1 = makeTab({ id: 1, url });
    const t2 = makeTab({ id: 2, url });
    const { tabs } = runRules([t1, t2]);

    expect(tabs[1].ruleFlags?.isExactDuplicate).toBe(true);
    expect(tabs[1].ruleFlags?.isNearDuplicate).toBe(false);
  });

  it('does not flag tabs with completely different paths on the same domain', () => {
    const t1 = makeTab({ id: 1, url: 'https://example.com/about' });
    const t2 = makeTab({ id: 2, url: 'https://example.com/products/category/item' });
    const { nearDuplicateCount } = runRules([t1, t2]);

    expect(nearDuplicateCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stale tabs
// ---------------------------------------------------------------------------

describe('runRules — stale tabs', () => {
  const DAYS = 24 * 60 * 60 * 1000;

  it('flags a tab as stale when lastAccessed exceeds the threshold', () => {
    const staleTime = Date.now() - 8 * DAYS;
    const tab = makeTab({ lastAccessed: staleTime });
    const { tabs, staleCount } = runRules([tab], 7);

    expect(tabs[0].ruleFlags?.isStale).toBe(true);
    expect(staleCount).toBe(1);
  });

  it('does not flag a tab as stale when it was accessed recently', () => {
    const recentTime = Date.now() - 2 * DAYS;
    const tab = makeTab({ lastAccessed: recentTime });
    const { tabs, staleCount } = runRules([tab], 7);

    expect(tabs[0].ruleFlags?.isStale).toBe(false);
    expect(staleCount).toBe(0);
  });

  it('does not flag a tab as stale when lastAccessed is undefined', () => {
    const tab = makeTab({ lastAccessed: undefined });
    const { tabs, staleCount } = runRules([tab], 7);

    expect(tabs[0].ruleFlags?.isStale).toBe(false);
    expect(staleCount).toBe(0);
  });

  it('respects a custom stale threshold', () => {
    const time = Date.now() - 3 * DAYS;
    const tab = makeTab({ lastAccessed: time });

    const resultDefault = runRules([tab], 7);
    expect(resultDefault.staleCount).toBe(0);

    const resultStrict = runRules([tab], 2);
    expect(resultStrict.staleCount).toBe(1);
  });

  it('correctly counts multiple stale tabs', () => {
    const staleTime = Date.now() - 10 * DAYS;
    const tabs = [1, 2, 3].map((id) => makeTab({ id, lastAccessed: staleTime }));
    const { staleCount } = runRules(tabs, 7);

    expect(staleCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// domainGroup flag
// ---------------------------------------------------------------------------

describe('runRules — domainGroup', () => {
  it('sets domainGroup to the tab domain', () => {
    const tab = makeTab({ url: 'https://github.com/repo', domain: 'github.com' });
    const { tabs } = runRules([tab]);

    expect(tabs[0].ruleFlags?.domainGroup).toBe('github.com');
  });
});

// ---------------------------------------------------------------------------
// Invalid URLs
// ---------------------------------------------------------------------------

describe('runRules — invalid URLs', () => {
  it('does not throw for a tab with an invalid URL', () => {
    const tab = makeTab({ url: 'not-a-url', domain: 'unknown' });
    expect(() => runRules([tab])).not.toThrow();
  });

  it('does not flag an invalid URL tab as a near-duplicate', () => {
    const t1 = makeTab({ id: 1, url: 'not-a-url', domain: 'unknown' });
    const t2 = makeTab({ id: 2, url: 'https://example.com/page' });
    const { nearDuplicateCount } = runRules([t1, t2]);

    expect(nearDuplicateCount).toBe(0);
  });
});
