import type { TabRecord } from '@shared/types';

const STOP = new Set('the and for with from this that your how what www https http com org net youtube github watch page home главная как что это для или'.split(' '));
export interface ReviewBatch { tabs: TabRecord[]; primaryIds: number[] }

export function buildReviewBatches(tabs: TabRecord[], excerpts: Record<number, string> = {}): ReviewBatch[] {
  if (tabs.length <= 65) return tabs.length ? [{ tabs, primaryIds: tabs.map((tab) => tab.id) }] : [];
  const words = tabs.map((tab) => {
    let path = ''; try { path = decodeURIComponent(new URL(tab.url).pathname); } catch { /* Title remains available. */ }
    return new Set((`${tab.title} ${path} ${(excerpts[tab.id] ?? '').slice(0, 500)}`.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !STOP.has(word)));
  });
  const index = new Map<string, number[]>();
  words.forEach((tokens, id) => tokens.forEach((word) => index.set(word, [...(index.get(word) ?? []), id])));
  const neighbors = words.map((tokens, id) => {
    const scores = new Map<number, { score: number; common: number }>();
    for (const word of tokens) {
      const matches = index.get(word)!;
      if (matches.length > tabs.length * .4) continue;
      const weight = 1 + Math.log((tabs.length + 1) / matches.length);
      for (const other of matches) if (other !== id) {
        const current = scores.get(other) ?? { score: 0, common: 0 };
        current.score += weight; current.common++; scores.set(other, current);
      }
    }
    return [...scores].filter(([, value]) => value.common >= 2 || value.score >= 3.5).sort((a, b) => b[1].score - a[1].score || a[0] - b[0]).slice(0, 6).map(([other, value]) => ({ id: other, score: value.score }));
  });
  const remaining = new Set(tabs.map((_, index) => index));
  const result: ReviewBatch[] = [];
  while (remaining.size) {
    const primary: number[] = []; const frontier = new Map<number, number>();
    while (primary.length < 45 && remaining.size) {
      const next = [...frontier].filter(([id]) => remaining.has(id)).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? remaining.values().next().value!;
      primary.push(next); remaining.delete(next); frontier.delete(next);
      for (const neighbor of neighbors[next]) frontier.set(neighbor.id, (frontier.get(neighbor.id) ?? 0) + neighbor.score);
    }
    const bridge = [...frontier].filter(([id]) => !primary.includes(id)).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 20).map(([id]) => id);
    result.push({ tabs: [...primary, ...bridge].map((id) => tabs[id]), primaryIds: primary.map((id) => tabs[id].id) });
  }
  return result;
}
