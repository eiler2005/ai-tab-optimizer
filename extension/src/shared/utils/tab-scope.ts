import type { TabRecord } from '@shared/types';

export interface ScopeSnapshot {
  tabIds?: number[];
  expectedUrls?: Record<number, string>;
  windowId?: number;
  scopeLabel?: string;
}
export function applyTabScope(tabs: TabRecord[], scope: ScopeSnapshot): TabRecord[] {
  if (scope.tabIds && (scope.tabIds.length > 20_000 || scope.tabIds.some((id) => !Number.isSafeInteger(id) || id < 0))) throw new Error('Invalid tab scope');
  const ids = scope.tabIds ? new Set(scope.tabIds) : null;
  return tabs.filter((tab) => (scope.windowId === undefined || tab.windowId === scope.windowId) && (!ids || ids.has(tab.id))
    && (!scope.expectedUrls || scope.expectedUrls[tab.id] === tab.url));
}
