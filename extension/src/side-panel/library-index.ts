import type { WindowGroup } from '@shared/types';
import type { SavedCollection } from '@shared/types/workspace';
import type { TopicCatalog } from '@shared/types/topics';
import { buildLibrary, searchLibrary, type LibraryPage } from '@shared/utils/library';
import { liveTopicTabs } from '@shared/utils/topics';

export type SearchScope = 'open' | 'saved' | 'all';
export function indexLibrary(windows: WindowGroup[], collections: SavedCollection[], catalog: TopicCatalog, sessionId: string): LibraryPage[] {
  const tabs = windows.flatMap((window) => window.tabs);
  const locations = new Map(tabs.map((tab) => [tab.id, tab.windowId]));
  const topics = catalog.topics.filter((topic) => !topic.deletedAt && !topic.mergedInto);
  const topicTabs = new Map(topics.map((topic) => [topic.id, new Set(liveTopicTabs(topic, tabs, sessionId).map((tab) => tab.id))]));
  return buildLibrary(windows, collections).map((page) => {
    const matched = topics.filter((topic) => page.liveTabIds.some((id) => topicTabs.get(topic.id)?.has(id))
      || topic.materials.some((material) => material.key === page.key || material.key === `saved:${page.saved[0]?.collectionId}:${page.saved[0]?.itemId}`));
    return { ...page, windowIds: [...new Set(page.liveTabIds.flatMap((id) => locations.has(id) ? [locations.get(id)!] : []))],
      topicIds: matched.map((topic) => topic.id), topicNames: matched.map((topic) => topic.name),
      notes: [...page.notes, ...matched.flatMap((topic) => [topic.focus, ...topic.aliases])] };
  });
}
export function scopedSearch(pages: LibraryPage[], query: string, scope: SearchScope): LibraryPage[] {
  return searchLibrary(pages, query).filter((page) => scope === 'all' || scope === 'open' && page.liveTabIds.length > 0 || scope === 'saved' && page.saved.length > 0);
}
