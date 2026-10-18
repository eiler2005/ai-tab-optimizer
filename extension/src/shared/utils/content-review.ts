import type { TabRecord } from '@shared/types';
import type { SimilarContentGroup, OutdatedContentTab } from '@shared/types/content-review';
import { survivorRank } from './rules';
import { isStatefulChat } from './page-safety';

const STOP = new Set('the and for with from this that your home login dashboard search new tab page главная вход поиск новая вкладка страница для или это как что'.split(' '));
const tokens = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !STOP.has(word)));
const overlap = (a: Set<string>, b: Set<string>) => {
  const common = [...a].filter((word) => b.has(word)).length;
  return { common, score: common / Math.max(a.size + b.size - common, 1) };
};

export function chooseContentSurvivor(tabs: TabRecord[]): number {
  return [...tabs].sort((a, b) => survivorRank(b) - survivorRank(a)
    || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || a.id - b.id)[0].id;
}

export function findSimilarContent(tabs: TabRecord[], excerpts: Record<number, string> = {}): SimilarContentGroup[] {
  tabs = tabs.filter((tab) => !isStatefulChat(tab.url));
  const groups: SimilarContentGroup[] = [];
  const titleTokens = new Map(tabs.map((tab) => [tab.id, tokens(tab.title)]));
  const contentTokens = new Map(tabs.map((tab) => [tab.id, tokens(excerpts[tab.id] ?? '')]));
  // An inverted index avoids comparing pages with no shared distinctive words.
  const index = new Map<string, number[]>();
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const words = new Set([...titleTokens.get(tab.id)!, ...contentTokens.get(tab.id)!]);
    const candidates = new Set<number>();
    for (const word of words) for (const previous of index.get(word) ?? []) candidates.add(previous);
    for (const previous of candidates) {
      const other = tabs[previous];
      if (tab.url === other.url) continue; // Exact URLs have their own review workflow.
      const title = overlap(titleTokens.get(tab.id)!, titleTokens.get(other.id)!);
      const content = overlap(contentTokens.get(tab.id)!, contentTokens.get(other.id)!);
      const sameContent = content.common >= 20 && content.score >= .72;
      if (!sameContent && !(title.common >= 4 && title.score >= .8)) continue;
      groups.push({ id: `local:${other.id}:${tab.id}`, tabIds: [other.id, tab.id],
        keepTabId: chooseContentSurvivor([other, tab]), confidence: sameContent ? content.score : title.score,
        source: sameContent ? 'content' : 'titles', relation: 'related',
        reason: sameContent ? 'Overlapping page excerpts' : 'Overlapping distinctive title words' });
      if (groups.length >= 200) return groups.sort((a, b) => b.confidence - a.confidence);
    }
    for (const word of words) index.set(word, [...(index.get(word) ?? []), i]);
  }
  return groups.sort((a, b) => b.confidence - a.confidence);
}

export function validateAiContentGroups(raw: unknown, tabs: TabRecord[]): SimilarContentGroup[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const seen = new Set<string>();
  return raw.slice(0, 100).flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const group = value as { tabIds?: unknown; reason?: unknown; confidence?: unknown; relation?: unknown; uniqueValue?: unknown };
    if (!Array.isArray(group.tabIds) || !group.tabIds.every((id) => typeof id === 'number' && Number.isInteger(id) && byId.has(id))
      || typeof group.reason !== 'string' || !group.reason.trim() || typeof group.confidence !== 'number'
      || !Number.isFinite(group.confidence) || group.confidence < .75 || group.confidence > 1) return [];
    const ids = [...new Set(group.tabIds as number[])].sort((a, b) => a - b);
    const members = ids.map((id) => byId.get(id)!);
    const key = ids.join(':');
    if (ids.length < 2 || new Set(members.map((tab) => tab.url)).size < 2 || seen.has(key) || members.some((tab) => isStatefulChat(tab.url))) return [];
    seen.add(key);
    return [{ id: `ai:${key}`, tabIds: ids, keepTabId: chooseContentSurvivor(members),
      reason: group.reason.trim().slice(0, 1200), confidence: group.confidence, source: 'ai' as const,
      relation: group.relation === 'redundant' ? 'redundant' as const : 'related' as const,
      uniqueValue: typeof group.uniqueValue === 'string' ? group.uniqueValue.slice(0, 1200) : undefined }];
  });
}

export function validateOutdatedTabs(raw: unknown, tabs: TabRecord[], excerpts: Record<number, string>): OutdatedContentTab[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const result = raw.slice(0, 600).flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Partial<OutdatedContentTab>;
    const tab = tabs.find((candidate) => candidate.id === item.tabId);
    if (!tab || isStatefulChat(tab.url) || seen.has(tab.id) || typeof item.reason !== 'string' || !item.reason.trim()
      || typeof item.evidence !== 'string' || item.evidence.trim().length < 3 || item.evidence.length > 500
      || !`${tab.title}\n${tab.url}\n${excerpts[tab.id] ?? ''}`.toLowerCase().includes(item.evidence.trim().toLowerCase())
      || typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < .8 || item.confidence > 1
      || (item.replacementTabId != null && (!tabs.some((candidate) => candidate.id === item.replacementTabId) || item.replacementTabId === tab.id))) return [];
    seen.add(tab.id);
    return [{ tabId: tab.id, reason: item.reason.trim().slice(0, 1200), evidence: item.evidence.trim(), confidence: item.confidence,
      replacementTabId: item.replacementTabId ?? undefined }];
  }).sort((a, b) => b.confidence - a.confidence);
  const replacements = new Set(result.flatMap((item) => item.replacementTabId === undefined ? [] : [item.replacementTabId]));
  return result.filter((item) => !replacements.has(item.tabId));
}
