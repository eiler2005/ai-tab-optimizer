import { expect, it } from 'vitest';
import { indexLibrary, scopedSearch } from '../library-index';
import { emptyTopicCatalog, reconcileTopics, topicMaterial } from '@shared/utils/topics';
import { makeTab } from '@shared/utils/__tests__/fixtures';
import type { SavedCollection } from '@shared/types/workspace';

const collection: SavedCollection = { id: 'c', name: 'My references', focus: 'Transaction migration', reason: 'Keep unique examples', purpose: 'reference', revision: 1, createdAt: 1, updatedAt: 1,
  windows: [{ id: 'w', focused: false, tabs: [{ itemId: 'i', savedAt: 1, url: 'https://a.test/Case', title: 'Guide', pinned: false, domain: 'a.test', note: 'Serializable isolation' }] }] };
it('uses one query for topic, note, saved purpose, collection and live window filters', () => {
  const catalog = reconcileTopics(emptyTopicCatalog(), [{ key: 'manual', name: 'Databases', focus: 'Migration task', accepted: true, materials: [topicMaterial('https://a.test/Case', 'Guide', 'x')] }]);
  const pages = indexLibrary([{ windowId: 7, focused: true, tabs: [makeTab({ id: 1, windowId: 7, url: 'https://a.test/Case' })] }], [collection], catalog, 's');
  expect(scopedSearch(pages, 'isolation topic:Databases window:7 collection:"My references" status:reference', 'all')).toHaveLength(1);
  expect(scopedSearch(pages, 'window:8', 'all')).toHaveLength(0);
  expect(scopedSearch(pages, 'Migration', 'open')).toHaveLength(1);
  expect(scopedSearch(pages, 'status:later', 'saved')).toHaveLength(0);
});
it('separates open-only and saved-only results and preserves exact URL case', () => {
  const pages = indexLibrary([{ windowId: 1, focused: true, tabs: [makeTab({ url: 'https://a.test/case' })] }], [collection], emptyTopicCatalog(), 's');
  expect(scopedSearch(pages, '', 'open')).toHaveLength(1);
  expect(scopedSearch(pages, '', 'saved')).toHaveLength(1);
  expect(scopedSearch(pages, '', 'all')).toHaveLength(2);
});
it('does not attach one saved chat topic to every live conversation with the same URL', () => {
  const chats = { ...collection, windows: [{ ...collection.windows[0], tabs: [{ ...collection.windows[0].tabs[0], url: 'https://chatgpt.com/' }] }] };
  const catalog = reconcileTopics(emptyTopicCatalog(), [{ key: 'c', name: 'Saved chat', focus: '', accepted: true, materials: [topicMaterial('https://chatgpt.com/', 'Chat', 'saved:c:i', ['c'])] }]);
  const pages = indexLibrary([{ windowId: 1, focused: true, tabs: [makeTab({ id: 1, url: 'https://chatgpt.com/' }), makeTab({ id: 2, url: 'https://chatgpt.com/' })] }], [chats], catalog, 's');
  expect(scopedSearch(pages, 'topic:"Saved chat"', 'open')).toHaveLength(0);
  expect(scopedSearch(pages, 'topic:"Saved chat"', 'saved')).toHaveLength(1);
});
