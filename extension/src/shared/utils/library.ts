import type { WindowGroup } from '@shared/types/tab';
import type { CollectionDetails, CollectionPurpose, SavedCollection } from '@shared/types/workspace';
import { isStatefulChat } from './page-safety';

export function collectionDetails(value: CollectionDetails): CollectionDetails {
  const result: CollectionDetails = {};
  if (value.purpose !== undefined) {
    if (!['now', 'later', 'reference'].includes(value.purpose)) throw new Error('Invalid collection purpose');
    result.purpose = value.purpose;
  }
  for (const key of ['reason', 'focus'] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || value[key]!.length > 1000) throw new Error('Collection description exceeds 1,000 characters');
      result[key] = value[key]!.trim();
    }
  }
  if (value.reviewAt !== undefined) {
    if (value.reviewAt !== null && (!Number.isSafeInteger(value.reviewAt) || value.reviewAt < 0 || value.reviewAt > 8_640_000_000_000_000)) throw new Error('Invalid review date');
    result.reviewAt = value.reviewAt;
  }
  return result;
}

export interface LibraryPage {
  key: string; url: string; title: string; notes: string[];
  liveTabIds: number[];
  windowIds?: number[];
  topicNames?: string[];
  topicIds?: string[];
  saved: { collectionId: string; itemId: string; name: string; purpose: CollectionPurpose }[];
}

export function buildLibrary(windows: WindowGroup[], collections: SavedCollection[]): LibraryPage[] {
  const pages = new Map<string, LibraryPage>();
  function page(url: string, title: string, location: string) {
    const key = isStatefulChat(url) ? location : url;
    let entry = pages.get(key);
    if (!entry) { entry = { key, url, title, notes: [], liveTabIds: [], saved: [] }; pages.set(key, entry); }
    return entry;
  }
  for (const window of windows) for (const tab of window.tabs) {
    if (/^https?:\/\//i.test(tab.url)) page(tab.url, tab.title, `live:${tab.id}`).liveTabIds.push(tab.id);
  }
  for (const collection of collections) {
    if (collection.deletedAt) continue;
    for (const window of collection.windows) for (const tab of window.tabs) {
      const entry = page(tab.url, tab.title, `saved:${collection.id}:${tab.itemId}`);
      entry.saved.push({ collectionId: collection.id, itemId: tab.itemId, name: collection.name, purpose: collection.purpose ?? 'reference' });
      entry.notes.push(...[tab.note, collection.reason, collection.focus].filter((text): text is string => Boolean(text)));
    }
  }
  return [...pages.values()];
}

export function searchLibrary(pages: LibraryPage[], query: string): LibraryPage[] {
  const terms = query.trim().toLocaleLowerCase().match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return pages.filter((page) => terms.every((term) => {
    const text = term.replace(/"/g, '');
    if (text.startsWith('collection:')) return page.saved.some((saved) => saved.name.toLocaleLowerCase().includes(text.slice(11)));
    if (text.startsWith('status:')) return text.slice(7) === 'open' ? page.liveTabIds.length > 0 : page.saved.some((saved) => saved.purpose === text.slice(7));
    if (text.startsWith('domain:')) return new URL(page.url).hostname.includes(text.slice(7));
    if (text.startsWith('topic:')) return (page.topicNames ?? []).some((name) => name.toLocaleLowerCase().includes(text.slice(6)));
    if (text.startsWith('window:')) return (page.windowIds ?? []).includes(Number(text.slice(7)));
    return [page.title, page.url, ...page.notes, ...page.saved.map((saved) => saved.name), ...(page.topicNames ?? [])].join('\n').toLocaleLowerCase().includes(text);
  }));
}
