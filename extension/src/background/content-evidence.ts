import type { TabRecord } from '@shared/types';

const KEY = 'aitab.content-evidence';
export interface ContentEvidence { title: string; text: string; capturedAt: number; depth: 'excerpt' | 'deep' }
export async function readEvidence(): Promise<Record<string, ContentEvidence>> {
  return (await chrome.storage.local.get(KEY))[KEY] as Record<string, ContentEvidence> ?? {};
}
export async function storeEvidence(tabs: TabRecord[], excerpts: Record<number, string>, depth: ContentEvidence['depth'] = 'excerpt') {
  const cache = await readEvidence();
  for (const tab of tabs) if (excerpts[tab.id]) cache[tab.url] = { title: tab.title, text: excerpts[tab.id], capturedAt: Date.now(), depth };
  const result: Record<string, ContentEvidence> = {};
  let bytes = 0;
  for (const [url, evidence] of Object.entries(cache).sort((a, b) => b[1].capturedAt - a[1].capturedAt)) {
    const size = new TextEncoder().encode(JSON.stringify([url, evidence])).length;
    if (bytes + size > 900_000) continue;
    result[url] = evidence; bytes += size;
  }
  await chrome.storage.local.set({ [KEY]: result });
}

export async function invalidateEvidence(url: string) {
  const cache = await readEvidence();
  if (cache[url]) { delete cache[url]; await chrome.storage.local.set({ [KEY]: cache }); }
}
