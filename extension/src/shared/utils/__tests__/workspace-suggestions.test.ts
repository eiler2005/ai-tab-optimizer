import { expect, it } from 'vitest';
import { buildWorkspaceSuggestions } from '../workspace-suggestions';
import { makeTab } from './fixtures';
import type { TopicCluster } from '@shared/types';

it('maps all current copies by exact URL while excluding hallucinated and case-folded pages', () => {
  const tabs = [makeTab({ id: 1, url: 'https://example.test/Doc' }), makeTab({ id: 2, url: 'https://example.test/Doc' }), makeTab({ id: 3, url: 'https://example.test/doc' })];
  const cluster: TopicCluster = { name: 'Docs', description: 'Related reference pages', tags: [], tabIds: [100], tabUrls: ['https://example.test/Doc', 'https://made-up.test/'] };
  const result = buildWorkspaceSuggestions([cluster], tabs);
  expect(result[0].tabIds).toEqual([1, 2]);
  expect(result[0].urls).toEqual(['https://example.test/Doc']);
});

it('ignores stale numeric IDs and groups with fewer than two live tabs', () => {
  const tabs = [makeTab({ id: 1 }), makeTab({ id: 2 })];
  const cluster: TopicCluster = { name: 'Old', description: '', tags: [], tabIds: [1, 2], tabUrls: [] };
  expect(buildWorkspaceSuggestions([cluster], tabs)).toEqual([]);
  expect(buildWorkspaceSuggestions([{ ...cluster, tabUrls: [tabs[0].url] }], tabs)).toEqual([]);
});
