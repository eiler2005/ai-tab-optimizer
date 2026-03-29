import type { TabRecord, RuleFlags } from '@shared/types';
import { normalizeUrl } from './url';

const STALE_DAYS_DEFAULT = 7;

export interface RuleEngineResult {
  tabs: TabRecord[];
  duplicateCount: number;
  nearDuplicateCount: number;
  staleCount: number;
}

export function runRules(
  tabs: TabRecord[],
  staleDaysThreshold = STALE_DAYS_DEFAULT
): RuleEngineResult {
  const now = Date.now();
  const staleMs = staleDaysThreshold * 24 * 60 * 60 * 1000;

  // 1. Normalize URLs for comparison
  const normalizedMap = new Map<string, number[]>(); // normalized URL → tab IDs
  for (const tab of tabs) {
    const norm = normalizeUrl(tab.url);
    if (!normalizedMap.has(norm)) normalizedMap.set(norm, []);
    normalizedMap.get(norm)!.push(tab.id);
  }

  // 2. Near-duplicate detection: same domain, similar path
  const domainPaths = new Map<string, { tabId: number; path: string }[]>();
  for (const tab of tabs) {
    try {
      const u = new URL(tab.url);
      const key = u.hostname;
      if (!domainPaths.has(key)) domainPaths.set(key, []);
      domainPaths.get(key)!.push({ tabId: tab.id, path: u.pathname + u.search });
    } catch {
      // skip invalid URLs
    }
  }

  const nearDupeIds = new Set<number>();
  for (const entries of domainPaths.values()) {
    if (entries.length < 2) continue;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        // Skip exact duplicates (handled separately)
        const normA = normalizeUrl(tabs.find((t) => t.id === entries[i].tabId)?.url ?? '');
        const normB = normalizeUrl(tabs.find((t) => t.id === entries[j].tabId)?.url ?? '');
        if (normA === normB) continue;

        if (pathSimilarity(entries[i].path, entries[j].path) > 0.8) {
          nearDupeIds.add(entries[i].tabId);
          nearDupeIds.add(entries[j].tabId);
        }
      }
    }
  }

  // 3. Apply flags to each tab
  let duplicateCount = 0;
  let nearDuplicateCount = 0;
  let staleCount = 0;

  const result = tabs.map((tab) => {
    const norm = normalizeUrl(tab.url);
    const dupeGroup = normalizedMap.get(norm) ?? [];
    const isExactDuplicate = dupeGroup.length > 1 && dupeGroup[0] !== tab.id;
    const duplicateOfTabId = isExactDuplicate ? dupeGroup[0] : undefined;
    const isNearDuplicate = !isExactDuplicate && nearDupeIds.has(tab.id);
    const isStale = tab.lastAccessed != null && (now - tab.lastAccessed) > staleMs;

    if (isExactDuplicate) duplicateCount++;
    if (isNearDuplicate) nearDuplicateCount++;
    if (isStale) staleCount++;

    const flags: RuleFlags = {
      isExactDuplicate,
      duplicateOfTabId,
      isNearDuplicate,
      isStale,
      domainGroup: tab.domain,
    };

    return { ...tab, ruleFlags: flags };
  });

  return { tabs: result, duplicateCount, nearDuplicateCount, staleCount };
}

/**
 * Simple path similarity based on common prefix ratio.
 * Returns 0-1 where 1 = identical.
 */
function pathSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  // Split by / and compare segments
  const segsA = a.split('/').filter(Boolean);
  const segsB = b.split('/').filter(Boolean);
  const maxSegs = Math.max(segsA.length, segsB.length);
  if (maxSegs === 0) return 1;

  let common = 0;
  for (let i = 0; i < Math.min(segsA.length, segsB.length); i++) {
    if (segsA[i] === segsB[i]) common++;
    else break;
  }

  // If paths share most segments, consider them similar
  return common / maxSegs;
}
