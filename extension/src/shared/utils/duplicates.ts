import type { TabRecord } from '@shared/types';
import type { DuplicatePreview, DuplicateReviewGroup } from '@shared/types/workspace';
import { exactUrlKey, normalizeUrl } from './url';
import { survivorRank } from './rules';
import { isStatefulChat } from './page-safety';

export function buildDuplicatePreview(tabs: TabRecord[], protectedDomains: string[] = []): DuplicatePreview {
  const exact = new Map<string, TabRecord[]>();
  const normalized = new Map<string, TabRecord[]>();
  for (const tab of tabs) {
    const key = exactUrlKey(tab.url);
    if (!key) continue;
    const copies = exact.get(key) ?? [];
    copies.push(tab);
    exact.set(key, copies);
    const candidate = normalizeUrl(key);
    const variants = normalized.get(candidate) ?? [];
    variants.push(tab);
    normalized.set(candidate, variants);
  }
  const groups: DuplicateReviewGroup[] = [];
  for (const [key, entries] of exact) {
    if (entries.length > 1) groups.push({ id: 'exact:' + key, kind: isStatefulChat(key) ? 'stateful' : 'exact',
      reason: isStatefulChat(key) ? 'Matching chat address; drafts and conversation state may differ. Review each tab manually.'
        : 'Full URL matches, including query and fragment.', tabs: entries, keepTabId: chooseSurvivor(entries).id });
  }
  for (const [key, entries] of normalized) {
    if (isStatefulChat(key)) continue;
    const variants = new Set(entries.map((tab) => exactUrlKey(tab.url)));
    if (variants.size > 1) {
      const representatives = [...variants].map((variant) => chooseSurvivor(exact.get(variant!)!));
      groups.push({ id: 'tracking:' + key, kind: 'tracking', reason: 'Only known tracking parameters differ; review before closing.',
        tabs: representatives, keepTabId: chooseSurvivor(representatives).id });
    }
  }
  return { id: crypto.randomUUID(), createdAt: Date.now(), groups, protectedDomains };
}

function chooseSurvivor(tabs: TabRecord[]): TabRecord {
  return [...tabs].sort((a, b) => survivorRank(b) - survivorRank(a)
    || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || a.id - b.id)[0];
}
