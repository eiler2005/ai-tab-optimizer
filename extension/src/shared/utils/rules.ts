import type { TabRecord, RuleFlags } from '@shared/types';
import { exactUrlKey } from './url';

export interface RuleEngineResult {
  tabs: TabRecord[];
  duplicateCount: number;
  nearDuplicateCount: number;
  staleCount: number;
}

export function tabProtectionReason(tab: TabRecord, domains: string[] = []): string | null {
  if (tab.userFlag === 'protected' || tab.userFlag === 'important') return 'marked important or protected';
  if (tab.pinned) return 'pinned';
  if (tab.active) return 'active';
  if (tab.audible) return 'playing audio';
  if (domains.some((d) => tab.domain === d || tab.domain.endsWith('.' + d))) return 'protected domain';
  return null;
}

export function survivorRank(tab: TabRecord): number {
  return (tab.userFlag === 'protected' ? 16 : tab.userFlag === 'important' ? 8 : 0)
    + (tab.pinned ? 4 : 0) + (tab.active ? 2 : 0) + (tab.audible ? 1 : 0);
}

export function runRules(tabs: TabRecord[], staleDaysThreshold = 7): RuleEngineResult {
  const cutoff = Date.now() - staleDaysThreshold * 86_400_000;
  const byUrl = new Map<string, TabRecord[]>();
  const byPrefix = new Map<string, { id: number; key: string }[]>();
  const near = new Set<number>();
  for (const tab of tabs) {
    const key = exactUrlKey(tab.url);
    if (!key) continue;
    const group = byUrl.get(key) ?? [];
    group.push(tab);
    byUrl.set(key, group);
    const url = new URL(key);
    const segments = url.pathname.split('/').filter(Boolean);
    // A >80% common segment prefix requires at least six segments.
    if (segments.length >= 6) {
      const prefixLength = Math.floor(segments.length * 0.8) + 1;
      const prefix = JSON.stringify([url.origin, segments.length, segments.slice(0, prefixLength)]);
      const entries = byPrefix.get(prefix) ?? [];
      entries.push({ id: tab.id, key });
      byPrefix.set(prefix, entries);
    }
  }
  for (const entries of byPrefix.values()) {
    if (new Set(entries.map((entry) => entry.key)).size > 1) {
      for (const entry of entries) near.add(entry.id);
    }
  }
  const survivors = new Map<string, number>();
  for (const [key, group] of byUrl) {
    const survivor = [...group].sort((a, b) => survivorRank(b) - survivorRank(a)
      || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || a.id - b.id)[0];
    survivors.set(key, survivor.id);
  }
  let duplicateCount = 0;
  let nearDuplicateCount = 0;
  let staleCount = 0;
  const result = tabs.map((tab) => {
    const key = exactUrlKey(tab.url);
    const survivor = key ? survivors.get(key) : undefined;
    const isExactDuplicate = survivor !== undefined && survivor !== tab.id;
    const isNearDuplicate = !isExactDuplicate && near.has(tab.id);
    const isStale = tab.lastAccessed != null && tab.lastAccessed < cutoff;
    duplicateCount += Number(isExactDuplicate);
    nearDuplicateCount += Number(isNearDuplicate);
    staleCount += Number(isStale);
    const flags: RuleFlags = { isExactDuplicate, duplicateOfTabId: isExactDuplicate ? survivor : undefined,
      isNearDuplicate, isStale, domainGroup: tab.domain };
    return { ...tab, ruleFlags: flags };
  });
  return { tabs: result, duplicateCount, nearDuplicateCount, staleCount };
}
