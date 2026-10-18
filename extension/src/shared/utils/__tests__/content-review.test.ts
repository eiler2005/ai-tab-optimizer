import { describe, expect, it } from 'vitest';
import { findSimilarContent, validateAiContentGroups, validateOutdatedTabs } from '../content-review';
import { makeTab } from './fixtures';

const tabs = [
  makeTab({ id: 1, url: 'https://a.test/guide', title: 'React server components practical migration guide', pinned: true }),
  makeTab({ id: 2, url: 'https://b.test/guide', title: 'React server components practical migration guide' }),
  makeTab({ id: 3, url: 'https://c.test/reference', title: 'React state hooks reference' }),
];

describe('content and obsolescence review', () => {
  it('finds cross-site title candidates, keeps protected copies and excludes merely related topics', () => {
    const groups = findSimilarContent(tabs);
    expect(groups).toHaveLength(1);
    expect(groups[0].tabIds).toEqual([1, 2]);
    expect(groups[0].keepTabId).toBe(1);
    expect(groups[0].source).toBe('titles');
  });
  it('ignores generic titles and leaves exact URL copies to the duplicate workflow', () => {
    expect(findSimilarContent([makeTab({ id: 1, title: 'Home dashboard new tab' }), makeTab({ id: 2, title: 'Home dashboard new tab' })])).toEqual([]);
    expect(findSimilarContent([tabs[0], { ...tabs[1], url: tabs[0].url }])).toEqual([]);
  });
  it('uses substantial page excerpt overlap even when titles differ', () => {
    const text = 'alpha beta gamma delta epsilon zeta theta lambda omega sigma letter programming content research scientific algorithm browser document available functions machine learning interface example';
    const groups = findSimilarContent([tabs[0], tabs[2]], { 1: text, 3: text });
    expect(groups[0].source).toBe('content');
  });
  it('drops hallucinated groups and low-confidence claims', () => {
    expect(validateAiContentGroups([{ tabIds: [1, 999], reason: 'bad', confidence: .99 }, { tabIds: [1, 2], reason: 'maybe', confidence: .5 }], tabs)).toEqual([]);
  });
  it('requires quoted evidence from the actual page and an existing replacement', () => {
    const raw = [
      { tabId: 2, reason: 'An explicit newer page replaces this guide', evidence: 'migration guide', confidence: .9, replacementTabId: 1 },
      { tabId: 3, reason: 'Old', evidence: 'Deadline 2024', confidence: .9 },
    ];
    expect(validateOutdatedTabs(raw, tabs, {}).map((item) => item.tabId)).toEqual([2]);
    expect(validateOutdatedTabs([{ ...raw[0], replacementTabId: 999 }], tabs, {})).toEqual([]);
  });
});
