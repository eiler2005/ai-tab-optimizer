import type { WindowGroup } from '@shared/types';

export interface TabFilter {
  searchQuery: string;
  tabScope: 'all' | 'current';
  tabTopicUrls: string[] | null;
  selectedTabIds: Set<number>;
  showSelectedOnly: boolean;
  searchMatchIds?: number[] | null;
}

export function filteredWindows(windows: WindowGroup[], filter: TabFilter): WindowGroup[] {
  const terms = filter.searchQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const urls = filter.tabTopicUrls ? new Set(filter.tabTopicUrls) : null;
  const matches = filter.searchMatchIds ? new Set(filter.searchMatchIds) : null;
  return windows.filter((window) => filter.tabScope !== 'current' || window.focused)
    .map((window) => ({ ...window, tabs: window.tabs.filter((tab) => (!urls || urls.has(tab.url))
      && (!filter.showSelectedOnly || filter.selectedTabIds.has(tab.id))
      && (matches ? matches.has(tab.id) : terms.every((term) => `${tab.title}\n${tab.url}\n${tab.domain}\n${tab.groupName ?? ''}`.toLocaleLowerCase().includes(term)))) }))
    .filter((window) => window.tabs.length > 0).sort((a, b) => Number(b.focused) - Number(a.focused));
}
